import { browser } from 'wxt/browser';
import { useEffect, useState } from 'preact/hooks';
import { send, type TabContext } from '../lib/messages';
import { ROBOTS_MAX_BYTES, robotsForStatus, type RobotsTxt } from '../lib/checks/robots';
import { defaultSitemaps, listsUrl, parseSitemap } from '../lib/checks/sitemap';
import {
  readConsentMode,
  type ConsentMode,
  type CookieRow,
  cookiePurpose,
} from '../lib/checks/tracking';
import { PROBE_GLOBALS } from '../lib/checks/tech';
import { OVERLAY_ID } from '../lib/overlay';
import { collectSnapshot } from '../lib/snapshot';
import { isPublicHost, sameSite } from '../lib/url';
import { DIGEST_INDEX, pruneIndex } from '../lib/history';
import { SETTINGS_KEY, withDefaults, type Settings } from '../lib/settings';
import type { PageSnapshot } from '../lib/types';
import type { UsageEvent } from '../lib/usage';
import { digest, diffDigests, type Change, type PageDigest } from '../lib/checks/diff';

// Everything the popup loads on open, memoised for the popup's lifetime so moving between
// pages never repeats a request. Site requests go straight from the popup (host permissions
// lift CORS); requests that need the user's token go through the worker.

const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!memo.has(key))
    memo.set(
      key,
      load().catch((e) => {
        memo.delete(key);
        throw e;
      }),
    );
  return memo.get(key) as Promise<T>;
}
export const forget = (prefix: string) =>
  [...memo.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => memo.delete(k));

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: undefined,
    error: null,
    loading: true,
  });
  // `deps` is the caller's list, as with useEffect itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: Error) =>
        live && setState({ data: undefined, error: e.message || String(e), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export async function currentTabId(): Promise<number> {
  const param = new URLSearchParams(location.search).get('tab');
  if (param) return Number(param);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

// Usage counters skip incognito tabs; the popup learns which tab it is for from the context.
let privateTab = false;

export const context = (tabId: number) =>
  send('tab:context', { tabId }).then((c) => {
    privateTab = c.incognito;
    return c;
  });

/** Counts one anonymous usage event in the worker; never fails the caller. */
export function track(event: UsageEvent): void {
  if (!privateTab) send('usage:count', { event }).catch(() => undefined);
}

export function settings(): Promise<Settings> {
  return browser.storage.local
    .get(SETTINGS_KEY)
    .then((r) => withDefaults(r[SETTINGS_KEY] as Partial<Settings>));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await settings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function snapshot(tabId: number): Promise<PageSnapshot> {
  return once(`snap:${tabId}`, async () => {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/analyser.js'] });
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: () =>
        (globalThis as unknown as { __vsSnapshot: () => Promise<PageSnapshot> }).__vsSnapshot(),
    });
    if (!res?.result) throw new Error('This page cannot be analysed.');
    return res.result as PageSnapshot;
  });
}

export interface Fetched {
  status: number;
  text: string;
  contentType: string;
  url: string;
  /** Body bytes read, before decoding. */
  bytes?: number;
}

const MB = 1024 * 1024;

interface RequestOptions {
  timeoutMs?: number;
  /** Bytes of body to read at most (after gunzip); the rest is not downloaded. */
  maxBytes?: number;
  /** False skips the body: enough for a status check. */
  body?: boolean;
}

/** Reads a stream into one buffer, stopping (and cancelling the stream) at `max` bytes. */
async function readAll(
  stream: ReadableStream<Uint8Array>,
  max: number,
  partial = false,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch (e) {
    // A truncated gzip file still yields what was inflated before the damage; any other
    // broken stream (a reset connection) is an error, not a shorter body.
    if (
      !partial ||
      !chunks.length ||
      (e as Error).name === 'TimeoutError' ||
      (e as Error).name === 'AbortError'
    )
      throw e;
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    if (at >= out.length) break;
    out.set(c.subarray(0, out.length - at), at);
    at += c.length;
  }
  return out;
}

/** The charset from Content-Type, else a <meta charset> or XML declaration in the first 1 KiB. */
function charsetOf(contentType: string, bytes: Uint8Array): string {
  const declared = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (declared) return declared;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return (
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)|<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i
      .exec(head)
      ?.slice(1)
      .find(Boolean) ?? 'utf-8'
  );
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes); // an unknown charset label
  }
}

export const OFFLINE_REDIRECT = 'Redirect not followed in offline mode';

/**
 * One request from the popup: no cookies, no cache, a timeout that also covers the body, and
 * at most `maxBytes` read. A gzip file (a sitemap.xml.gz, not Content-Encoding, which fetch
 * already undoes) is inflated, and the text is decoded with the page's own charset.
 *
 * Every caller asks the host being viewed. In offline mode a redirect is not followed, since
 * it could lead to another host; it fails with OFFLINE_REDIRECT instead.
 */
async function request(
  url: string,
  init: RequestInit = {},
  { timeoutMs = 10_000, maxBytes = 5 * MB, body = init.method !== 'HEAD' }: RequestOptions = {},
): Promise<Fetched> {
  const follow = (init.redirect ?? 'follow') === 'follow';
  const offline =
    follow &&
    // Unreadable settings count as offline: the gate fails closed.
    (await settings().then(
      (s) => s.offline,
      () => true,
    ));
  const res = await fetch(url, {
    credentials: 'omit',
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    ...init,
    ...(offline ? { redirect: 'manual' as const } : {}),
  });
  if (offline && res.type === 'opaqueredirect') throw new Error(OFFLINE_REDIRECT);
  const contentType = res.headers.get('content-type') ?? '';
  let text = '';
  let size = 0;
  if (body && res.body) {
    let bytes = await readAll(res.body, maxBytes);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b)
      bytes = await readAll(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        maxBytes,
        true,
      );
    text = decodeText(bytes, contentType);
    size = bytes.length;
  } else if (res.body) {
    // Headers are all a status check needs; dropping the body frees the connection.
    res.body.cancel().catch(() => undefined);
  }
  return { status: res.status, text, contentType, url: res.url, bytes: size };
}

export function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Fetched> {
  return once(
    `fetch:${init.method ?? 'GET'}:${init.redirect ?? 'follow'}:${JSON.stringify(init.headers ?? {})}:${url}`,
    () => request(url, init, { timeoutMs }),
  );
}

export function robots(
  origin: string,
): Promise<{ status: number; text: string; parsed: RobotsTxt } | null> {
  return once(`robots:${origin}`, async () => {
    try {
      const r = await request(`${origin}/robots.txt`, {}, { maxBytes: ROBOTS_MAX_BYTES });
      const ok = r.status >= 200 && r.status < 300;
      const text = ok && !/html/i.test(r.contentType) ? r.text : '';
      return { status: r.status, text, parsed: robotsForStatus(r.status, text) };
    } catch {
      return null;
    }
  });
}

export interface SitemapCheck {
  sources: { url: string; status: number; kind: string; count: number }[];
  listed: boolean | null;
}

/** Sitemap files read per page, how deep indexes nest, and the protocol's size limit. */
const SITEMAP_FILES = 20;
const SITEMAP_DEPTH = 2;
const SITEMAP_PARALLEL = 2; // each file may be 50 MB; more at once strains the popup

/** Runs `task` over `items`, `limit` at a time, keeping the order of the results. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const sitemapKey = (pageUrl: string) => `sitemaps:${new URL(pageUrl).origin}:${pageUrl}`;

/**
 * The sitemap check if the Indexability page already ran it, else null. Sitemaps can be large,
 * so only opening that page fetches them.
 */
export function sitemapsIfChecked(pageUrl: string): Promise<SitemapCheck | null> {
  const checked = memo.get(sitemapKey(pageUrl)) as Promise<SitemapCheck> | undefined;
  return checked ? checked.catch(() => null) : Promise.resolve(null);
}

/**
 * Sitemaps from robots.txt (or /sitemap.xml), following indexes two levels deep, at most 20
 * files, four at a time. Gzipped files are read too. Bodies are parsed and dropped, so a
 * 50,000-URL file is not kept in memory.
 */
export function sitemaps(pageUrl: string): Promise<SitemapCheck> {
  const origin = new URL(pageUrl).origin;
  return once(sitemapKey(pageUrl), async () => {
    const resolve = (u: string) => {
      try {
        return new URL(u, origin).href;
      } catch {
        return null;
      }
    };
    // A robots.txt or sitemap index can name any URL. Sitemaps often live on the site's CDN,
    // so public hosts are fine, but a hostile file must not point the extension's host access
    // at localhost or the local network unless the page itself is there. Offline mode allows
    // the viewed host only.
    const { offline } = await settings();
    const host = new URL(pageUrl).hostname;
    const fetchable = (url: string) =>
      /^https?:/.test(url) &&
      (offline
        ? new URL(url).hostname === host
        : isPublicHost(new URL(url).hostname) || sameSite(url, pageUrl));
    const declared = ((await robots(origin))?.parsed.sitemaps ?? [])
      .map(resolve)
      .filter((u): u is string => !!u);
    const sources: SitemapCheck['sources'] = [];
    const seen = new Set<string>();
    let listed = false;
    let budget = SITEMAP_FILES;
    let level = declared.length ? declared.slice(0, 5) : defaultSitemaps(origin);
    for (let depth = 0; depth <= SITEMAP_DEPTH && level.length && budget > 0; depth++) {
      const batch = level.filter((u) => !seen.has(u) && seen.add(u)).slice(0, budget);
      budget -= batch.filter(fetchable).length;
      const results = await pool(batch, SITEMAP_PARALLEL, async (url) => {
        if (!fetchable(url)) return { url, status: 0, kind: 'skipped', count: 0, children: [] };
        try {
          const r = await request(url, {}, { timeoutMs: 20_000, maxBytes: 50 * MB });
          const sm = parseSitemap(r.status === 200 ? r.text : '');
          if (sm.kind === 'urlset' && !listed) listed = listsUrl(sm.locs, pageUrl);
          const children = sm.kind === 'index' ? sm.locs : [];
          return { url, status: r.status, kind: sm.kind, count: sm.locs.length, children };
        } catch {
          return { url, status: 0, kind: 'unknown', count: 0, children: [] };
        }
      });
      sources.push(
        ...results.map(({ url, status, kind, count }) => ({ url, status, kind, count })),
      );
      level = results.flatMap((r) => r.children.map(resolve).filter((u): u is string => !!u));
    }
    return { sources, listed: sources.some((s) => s.kind === 'urlset') ? listed : null };
  });
}

/** Googlebot reads the first 15 MB of an HTML file; nothing after that is indexed. */
const HTML_MAX_BYTES = 15 * MB;

/** The page as a non-rendering crawler gets it. */
export function rawSnapshot(
  url: string,
): Promise<{ status: number; snapshot: PageSnapshot | null }> {
  return once(`raw:${url}`, async () => {
    const r = await request(url, {}, { maxBytes: HTML_MAX_BYTES });
    // A missing Content-Type is sniffed the way a browser would.
    const html = r.contentType
      ? /html/i.test(r.contentType)
      : /^\s*<(!doctype html|html|head)/i.test(r.text);
    if (!html) return { status: r.status, snapshot: null };
    const doc = new DOMParser().parseFromString(r.text, 'text/html');
    const snap = collectSnapshot(doc, null, r.url || url);
    return {
      status: r.status,
      snapshot: { ...snap, htmlBytes: r.bytes ?? 0 },
    };
  });
}

export interface Probe {
  globals: string[];
  consentMode: ConsentMode | null;
}

/** Reads page globals in the MAIN world; it only reports names and the consent commands. */
export function probe(tabId: number): Promise<Probe> {
  return once(`probe:${tabId}`, async () => {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [PROBE_GLOBALS],
      func: (names: string[]) => {
        const w = window as unknown as Record<string, unknown>;
        const dl = Array.isArray(w.dataLayer) ? (w.dataLayer as unknown[]) : [];
        const consent = dl
          .map((e) =>
            e && typeof e === 'object' && 'length' in (e as object)
              ? Array.from(e as ArrayLike<unknown>)
              : e,
          )
          .filter((e) => Array.isArray(e) && e[0] === 'consent');
        return {
          globals: names.filter((n) => n in w),
          consent: JSON.parse(JSON.stringify(consent)) as unknown[],
        };
      },
    });
    const out = (res?.result ?? { globals: [], consent: [] }) as {
      globals: string[];
      consent: unknown[];
    };
    return { globals: out.globals, consentMode: readConsentMode(out.consent) };
  });
}

/** Cookies for the URL from the tab's own cookie store (incognito tabs have their own). */
export function cookies(url: string, tabId: number): Promise<CookieRow[]> {
  return once(`cookies:${tabId}:${url}`, async () => {
    const stores = await browser.cookies.getAllCookieStores();
    const storeId = stores.find((s) => s.tabIds.includes(tabId))?.id;
    return (await browser.cookies.getAll({ url, ...(storeId ? { storeId } : {}) })).map((c) => ({
      name: c.name,
      domain: c.domain,
      purpose: cookiePurpose(c.name),
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      session: c.session,
      expires: c.expirationDate ?? null,
    }));
  });
}

export interface AxeResult {
  violations: {
    id: string;
    impact: string;
    help: string;
    helpUrl: string;
    nodes: { target: string; summary: string }[];
    count: number;
  }[];
  passes: number;
  passIds: string[];
}

export function runAxe(tabId: number, fresh = false): Promise<AxeResult> {
  if (fresh) forget(`axe:${tabId}`);
  return once(`axe:${tabId}`, async () => {
    track('axe.run');
    await browser.scripting.executeScript({ target: { tabId }, files: ['/axe.js'] });
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as unknown as { __vsAxe: () => Promise<unknown> }).__vsAxe(),
    });
    if (!res?.result) throw new Error('This page cannot be analysed.');
    return res.result as AxeResult;
  }).catch((e: Error) => {
    track('error.axe');
    throw e;
  });
}

/**
 * Draws or removes the LCP and layout-shift overlay in the tab. It is drawn by the analyser
 * (injected again if the page reloaded since), not the every-page content script, so it also
 * works on tabs that were open before the extension was installed or updated.
 */
export async function overlay(
  tabId: number,
  on: boolean,
): Promise<{ lcp: boolean; shifts: number } | undefined> {
  if (on) track('overlay.show');
  const call = async () => {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      args: [on],
      func: (show: boolean) => {
        const draw = (globalThis as { __vsOverlay?: (s: boolean) => Promise<unknown> }).__vsOverlay;
        return draw ? draw(show) : null;
      },
    });
    return res?.result as { lcp: boolean; shifts: number } | null | undefined;
  };
  const first = await call();
  if (first) return first;
  await browser.scripting.executeScript({ target: { tabId }, files: ['/analyser.js'] });
  return (await call()) ?? undefined;
}

/** Whether the overlay is on the page, so the switch matches it when the popup reopens. */
export function overlayShown(tabId: number): Promise<boolean> {
  return browser.scripting
    .executeScript({
      target: { tabId },
      args: [OVERLAY_ID],
      func: (id: string) => !!document.getElementById(id),
    })
    .then(([res]) => res?.result === true)
    .catch(() => false);
}

/**
 * Reloads the tab and resolves when it has loaded again, or after `timeoutMs`, or when the
 * tab closes. Results read from the old page are forgotten.
 */
export async function reloadTab(tabId: number, timeoutMs = 20_000): Promise<void> {
  await new Promise<void>((resolve) => {
    let started = false;
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      resolve();
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id !== tabId) return;
      if (info.status === 'loading') started = true;
      else if (info.status === 'complete' && started) done();
    };
    const onRemoved = (id: number) => id === tabId && done();
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.reload(tabId).catch(done);
  });
  for (const prefix of ['snap', 'probe', 'axe']) forget(`${prefix}:${tabId}`);
  forget(`cookies:${tabId}:`);
}

/**
 * Status of one link without its body: HEAD, then GET when the server refuses HEAD (400, 403,
 * 405, 501) or drops it without an answer. Other errors (401, 404, 410, 429, 5xx) are trusted,
 * so an erroring link is not asked twice. A manual redirect is opaque, reported as 300.
 */
const HEAD_REFUSED = new Set([400, 403, 405, 501]);

function linkStatus(url: string): Promise<number> {
  return once(`link:${url}`, async () => {
    const check = (method: 'HEAD' | 'GET') =>
      request(url, { method, redirect: 'manual' }, { timeoutMs: 8000, body: false });
    try {
      const r = await check('HEAD');
      if (!HEAD_REFUSED.has(r.status)) return r.status || 300;
    } catch (e) {
      // A server that does not answer HEAD in time will not answer GET faster.
      if ((e as Error).name === 'TimeoutError') throw e;
    }
    return (await check('GET')).status || 300;
  });
}

/** Checks each http(s) link once, six at a time; links that differ only in #fragment share one. */
export async function linkStatuses(
  urls: string[],
  onResult: (url: string, status: number) => void,
): Promise<void> {
  track('links.check');
  const byResource = new Map<string, string[]>();
  for (const u of new Set(urls)) {
    if (!/^https?:/.test(u)) continue;
    const key = u.split('#')[0];
    byResource.set(key, [...(byResource.get(key) ?? []), u]);
  }
  await pool([...byResource], 6, async ([url, originals]) => {
    const status = await linkStatus(url).catch(() => 0);
    for (const u of originals) onResult(u, status);
  });
}

/** Compares with the stored digest of this URL, then stores the current one. */
export async function changesSinceLastVisit(
  snap: PageSnapshot,
  ctx: TabContext,
  enabled: boolean,
): Promise<{ since: number; changes: Change[] } | null> {
  if (!enabled || ctx.incognito) return null;
  return once(`digest:${snap.url}`, async () => {
    const key = `digest:${snap.url.split('#')[0]}`;
    const {
      [key]: prev,
      [DIGEST_INDEX]: index = [],
      [SETTINGS_KEY]: stored,
    } = (await browser.storage.local.get([key, DIGEST_INDEX, SETTINGS_KEY])) as Record<
      string,
      unknown
    > & { [DIGEST_INDEX]?: [string, number][] };
    // Read again here: the history may have been switched off since this popup loaded settings.
    if (!withDefaults(stored as Partial<Settings>).rememberChanges) return null;
    const now = digest(snap, ctx.nav);
    const { keep, drop } = pruneIndex([[key, now.at], ...index.filter(([k]) => k !== key)], now.at);
    await browser.storage.local.set({ [key]: now, [DIGEST_INDEX]: keep });
    if (drop.length) await browser.storage.local.remove(drop);
    const before = prev as PageDigest | undefined;
    return before ? { since: before.at, changes: diffDigests(before, now) } : null;
  });
}

export { pruneIndex } from '../lib/history';
