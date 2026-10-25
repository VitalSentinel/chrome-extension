import { browser, type Browser } from 'wxt/browser';
import type { NavRecord } from '../lib/types';

// Records the top-level navigation of each tab: status, response headers and redirect hops.
// Observe-only webRequest listeners on main_frame requests – nothing is blocked, and
// subresources are not watched (the popup reads those from the page's performance timeline),
// so ordinary browsing does not keep the worker busy. Records live in memory and in
// chrome.storage.session, so a restarted worker keeps them.

const records = new Map<number, NavRecord>();
// The record a new main-frame request replaced, restored when that request turns out not to
// replace the page (a download or a 204).
const previous = new Map<number, NavRecord>();
// Speculation rules prerender pages in the same tab before the user follows a link. Their
// responses must not replace the page on screen, so they wait here (by request, then by tab)
// until the tab shows that URL.
const prerendering = new Map<string, NavRecord>();
const prerendered = new Map<number, NavRecord[]>();
const PRERENDERED_MAX = 5;

const key = (tabId: number) => `nav:${tabId}`;

function save(tabId: number) {
  const rec = records.get(tabId);
  if (rec) void browser.storage.session.set({ [key(tabId)]: rec });
}

const withoutHash = (url: string) => url.split('#')[0];

export async function getNav(tabId: number): Promise<NavRecord | null> {
  let rec = records.get(tabId);
  if (!rec) {
    rec = (await browser.storage.session.get(key(tabId)))[key(tabId)] as NavRecord | undefined;
    if (rec) records.set(tabId, rec);
  }
  const waiting = prerendered.get(tabId);
  if (waiting?.length) {
    // The tab may have activated a prerendered page; no request marks that moment.
    const tab = await browser.tabs.get(tabId).catch(() => null);
    const url = tab?.url ? withoutHash(tab.url) : '';
    // Re-read after the await: a response or a new navigation may have arrived meanwhile.
    const list = prerendered.get(tabId) ?? [];
    const shown = list.find((r) => withoutHash(r.url) === url);
    if (shown && records.get(tabId) === rec && (!rec || withoutHash(rec.url) !== url)) {
      prerendered.set(
        tabId,
        list.filter((r) => r !== shown),
      );
      records.set(tabId, shown);
      save(tabId);
      rec = shown;
    }
  }
  return rec ?? null;
}

type Details = { tabId: number; requestId?: string; documentLifecycle?: string };
const isPrerender = (d: Details) => d.documentLifecycle === 'prerender';
/** The record a webRequest event belongs to: the tab's, or a prerender's by request. */
const recordFor = (d: Details) =>
  isPrerender(d) ? prerendering.get(d.requestId ?? '') : records.get(d.tabId);

const headerValue = (headers: Browser.webRequest.HttpHeader[] | undefined, name: string) =>
  headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';

/**
 * Response headers as recorded. A Set-Cookie value is a session secret; only the cookie's
 * name and attributes are kept (`sid=…; Path=/; HttpOnly`), which is all the checks need.
 */
function redactCookie(value: string): string {
  if (!value) return value;
  const end = value.indexOf(';');
  const pair = end < 0 ? value : value.slice(0, end);
  const eq = pair.indexOf('=');
  // A pair without "=" is a nameless cookie: all of it is the value.
  return (eq < 0 ? '…' : `${pair.slice(0, eq)}=…`) + (end < 0 ? '' : value.slice(end));
}

export function recordHeaders(headers: Browser.webRequest.HttpHeader[] | undefined) {
  return (headers ?? []).map((h): [string, string] => {
    const value = h.value ?? '';
    return [h.name, h.name.toLowerCase() === 'set-cookie' ? redactCookie(value) : value];
  });
}

export function startNavigation() {
  const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame' as const] };

  browser.webRequest.onBeforeRequest.addListener((d) => {
    if (d.tabId < 0) return;
    if (isPrerender(d)) {
      // Requests that fail never reach onHeadersReceived; keep the map small.
      if (prerendering.size > 20) prerendering.delete(prerendering.keys().next().value!);
      // A redirect keeps its request ID, and with it the hops collected so far.
      if (!prerendering.has(d.requestId))
        prerendering.set(d.requestId, {
          tabId: d.tabId,
          url: d.url,
          status: 0,
          statusLine: '',
          headers: [],
          redirects: [],
          clientRedirect: false,
          startedAt: d.timeStamp,
        });
      return;
    }
    const prev = records.get(d.tabId);
    // A request that follows a redirect keeps the hops collected so far.
    if (prev && prev.status >= 300 && prev.status < 400 && prev.url === d.url) return;
    if (prev) previous.set(d.tabId, prev);
    records.set(d.tabId, {
      tabId: d.tabId,
      url: d.url,
      status: 0,
      statusLine: '',
      headers: [],
      redirects: [],
      clientRedirect: false,
      startedAt: d.timeStamp,
    });
  }, filter);

  browser.webRequest.onBeforeRedirect.addListener((d) => {
    const rec = recordFor(d);
    if (!rec) return;
    rec.url = d.redirectUrl;
    // HSTS and HTTPS-upgrade redirects happen inside Chrome; they never reached the server.
    if (/internal redirect/i.test(d.statusLine)) return;
    rec.redirects.push({ url: d.url, status: d.statusCode, location: d.redirectUrl });
    rec.status = d.statusCode;
  }, filter);

  browser.webRequest.onHeadersReceived.addListener(
    (d) => {
      const rec = recordFor(d);
      if (!rec || (d.statusCode >= 300 && d.statusCode < 400)) return;
      const attachment = /^\s*attachment/i.test(
        headerValue(d.responseHeaders, 'content-disposition'),
      );
      if (isPrerender(d)) {
        prerendering.delete(d.requestId);
        if (d.statusCode === 204 || attachment) return;
        Object.assign(rec, {
          url: d.url,
          status: d.statusCode,
          statusLine: d.statusLine,
          headers: recordHeaders(d.responseHeaders),
        });
        const list = (prerendered.get(d.tabId) ?? []).filter((r) => r.url !== rec.url);
        prerendered.set(d.tabId, [...list, rec].slice(-PRERENDERED_MAX));
        return;
      }
      if (d.statusCode === 204 || attachment) {
        const prev = previous.get(d.tabId);
        if (prev) records.set(d.tabId, prev);
        else records.delete(d.tabId);
        return;
      }
      previous.delete(d.tabId);
      rec.url = d.url;
      rec.status = d.statusCode;
      rec.statusLine = d.statusLine;
      rec.headers = recordHeaders(d.responseHeaders);
      save(d.tabId);
    },
    filter,
    ['responseHeaders', 'extraHeaders'],
  );

  browser.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0 || isPrerender(d)) return;
    const rec = records.get(d.tabId);
    // A page its service worker answers makes no main-frame request, so the record (in memory, or
    // in storage after a worker restart) is still the page before; it must not stand in for this one.
    if (!rec || withoutHash(rec.url) !== withoutHash(d.url)) {
      records.delete(d.tabId);
      void browser.storage.session.remove(key(d.tabId));
      return;
    }
    if (d.transitionQualifiers.includes('client_redirect')) {
      rec.clientRedirect = true;
      save(d.tabId);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    records.delete(tabId);
    previous.delete(tabId);
    prerendered.delete(tabId);
    void browser.storage.session.remove(key(tabId));
  });
}
