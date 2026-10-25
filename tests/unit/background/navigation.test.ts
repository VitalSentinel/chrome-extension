import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { NavRecord } from '../../../src/lib/types';
import { flush } from './helpers';

type Listener = (details: Record<string, unknown>) => void;
type Nav = typeof import('../../../src/background/navigation');

const EVENTS = ['onBeforeRequest', 'onBeforeRedirect', 'onHeadersReceived'] as const;
let on: Record<(typeof EVENTS)[number], Listener>;
let addListener: Record<(typeof EVENTS)[number], ReturnType<typeof vi.fn>>;
let mod: Nav;

/** A fresh module (empty in-memory records) with its webRequest listeners captured. */
async function start() {
  vi.resetModules();
  mod = await import('../../../src/background/navigation');
  on = {} as typeof on;
  addListener = {} as typeof addListener;
  const webRequest: Record<string, { addListener: ReturnType<typeof vi.fn> }> = {};
  for (const name of EVENTS) {
    addListener[name] = vi.fn((cb: Listener) => (on[name] = cb));
    webRequest[name] = { addListener: addListener[name] };
  }
  fakeBrowser.webRequest = webRequest as never;
  mod.startNavigation();
}

const TAB = 4;
const stored = async (tabId = TAB) =>
  (await fakeBrowser.storage.session.get(`nav:${tabId}`))[`nav:${tabId}`] as NavRecord | undefined;

const request = (url: string, timeStamp = 1_000) =>
  on.onBeforeRequest({ tabId: TAB, url, timeStamp, type: 'main_frame' });
const redirect = (
  url: string,
  redirectUrl: string,
  statusCode = 301,
  statusLine = `HTTP/1.1 ${statusCode} Moved Permanently`,
) => on.onBeforeRedirect({ tabId: TAB, url, redirectUrl, statusCode, statusLine });
const headers = (
  url: string,
  statusCode = 200,
  responseHeaders: { name: string; value?: string }[] = [],
  statusLine = `HTTP/1.1 ${statusCode} OK`,
) => on.onHeadersReceived({ tabId: TAB, url, statusCode, statusLine, responseHeaders });

const record = (overrides: Partial<NavRecord>): NavRecord => ({
  tabId: TAB,
  url: 'https://www.example.com/',
  status: 0,
  statusLine: '',
  headers: [],
  redirects: [],
  clientRedirect: false,
  startedAt: 1_000,
  ...overrides,
});

beforeEach(async () => {
  fakeBrowser.reset();
  await start();
});

describe('startNavigation', () => {
  it('observes http(s) main frames only, with response headers', () => {
    const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] };
    expect(addListener.onBeforeRequest).toHaveBeenCalledWith(expect.any(Function), filter);
    expect(addListener.onBeforeRedirect).toHaveBeenCalledWith(expect.any(Function), filter);
    expect(addListener.onHeadersReceived).toHaveBeenCalledWith(expect.any(Function), filter, [
      'responseHeaders',
      'extraHeaders',
    ]);
  });
});

describe('a navigation through redirects', () => {
  it('records hops, the final status and headers, and saves them at once', async () => {
    request('http://example.com/', 1_000);
    headers(
      'http://example.com/',
      301,
      [{ name: 'Location', value: 'https://www.example.com/' }],
      'HTTP/1.1 301 Moved Permanently',
    );
    redirect('http://example.com/', 'https://www.example.com/', 301);
    // The request for the redirect target keeps the hops collected so far.
    request('https://www.example.com/', 1_040);
    headers('https://www.example.com/', 200, [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'X-Robots-Tag', value: 'noindex' },
      { name: 'Set-Cookie' },
    ]);

    const expected = record({
      status: 200,
      statusLine: 'HTTP/1.1 200 OK',
      headers: [
        ['Content-Type', 'text/html; charset=utf-8'],
        ['X-Robots-Tag', 'noindex'],
        ['Set-Cookie', ''],
      ],
      redirects: [
        { url: 'http://example.com/', status: 301, location: 'https://www.example.com/' },
      ],
    });
    expect(await mod.getNav(TAB)).toEqual(expected);
    await flush();
    expect(await stored()).toEqual(expected);
  });

  it('does not count a redirect made inside Chrome as a hop', async () => {
    request('http://www.example.com/', 1_000);
    redirect(
      'http://www.example.com/',
      'https://www.example.com/',
      307,
      'HTTP/1.1 307 Internal Redirect',
    );
    request('https://www.example.com/', 1_002);
    headers('https://www.example.com/');
    expect(await mod.getNav(TAB)).toMatchObject({
      url: 'https://www.example.com/',
      status: 200,
      redirects: [],
    });
  });

  // Fails today: after the 301, Chrome's internal HTTPS upgrade changes the URL, so the next
  // request no longer matches the last hop's `location` and a fresh record drops the 301.
  it('keeps a server hop that is followed by an internal HTTPS upgrade', async () => {
    request('http://example.com/', 1_000);
    redirect('http://example.com/', 'http://www.example.com/', 301);
    request('http://www.example.com/', 1_010);
    redirect(
      'http://www.example.com/',
      'https://www.example.com/',
      307,
      'HTTP/1.1 307 Internal Redirect',
    );
    request('https://www.example.com/', 1_012);
    headers('https://www.example.com/');
    expect((await mod.getNav(TAB))!.redirects).toEqual([
      { url: 'http://example.com/', status: 301, location: 'http://www.example.com/' },
    ]);
  });

  it('starts a fresh record for a navigation that is not the redirect target', async () => {
    request('http://example.com/');
    redirect('http://example.com/', 'https://www.example.com/login', 302);
    request('https://elsewhere.example.org/', 5_000);
    expect(await mod.getNav(TAB)).toEqual(
      record({ url: 'https://elsewhere.example.org/', startedAt: 5_000 }),
    );
  });

  it('keeps an empty header list when Chrome sends none', async () => {
    request('https://www.example.com/missing');
    on.onHeadersReceived({
      tabId: TAB,
      url: 'https://www.example.com/missing',
      statusCode: 404,
      statusLine: 'HTTP/1.1 404 Not Found',
    });
    expect(await mod.getNav(TAB)).toMatchObject({ status: 404, headers: [] });
  });

  it('ignores requests outside a tab and events for tabs without a record', async () => {
    on.onBeforeRequest({
      tabId: -1,
      url: 'https://www.example.com/',
      timeStamp: 1,
      type: 'main_frame',
    });
    on.onBeforeRedirect({
      tabId: 8,
      url: 'http://a.example/',
      statusCode: 301,
      redirectUrl: 'https://a.example/',
      statusLine: 'HTTP/1.1 301',
    });
    on.onHeadersReceived({
      tabId: 8,
      url: 'https://a.example/',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
    });
    expect(await mod.getNav(-1)).toBeNull();
    expect(await mod.getNav(8)).toBeNull();
  });
});

describe('responses that do not replace the page', () => {
  const page = async () => {
    request('https://www.example.com/report', 1_000);
    headers('https://www.example.com/report', 200, [{ name: 'Content-Type', value: 'text/html' }]);
    return (await mod.getNav(TAB))!;
  };

  it.each([
    {
      name: 'a download',
      status: 200,
      h: [{ name: 'Content-Disposition', value: 'attachment; filename="report.pdf"' }],
    },
    { name: 'a 204', status: 204, h: [] },
  ])('restores the previous record after $name', async ({ status, h }) => {
    const before = structuredClone(await page());
    request('https://www.example.com/report.pdf', 2_000);
    headers('https://www.example.com/report.pdf', status, h);
    expect(await mod.getNav(TAB)).toEqual(before);
  });

  it('has no record when the first request of a tab is a download', async () => {
    request('https://www.example.com/report.pdf', 2_000);
    headers('https://www.example.com/report.pdf', 200, [
      { name: 'content-disposition', value: 'attachment' },
    ]);
    expect(await mod.getNav(TAB)).toBeNull();
  });

  it('does not treat an inline Content-Disposition as a download', async () => {
    request('https://www.example.com/terms.pdf');
    headers('https://www.example.com/terms.pdf', 200, [
      { name: 'Content-Disposition', value: 'inline; filename="terms.pdf"' },
    ]);
    expect(await mod.getNav(TAB)).toMatchObject({
      url: 'https://www.example.com/terms.pdf',
      status: 200,
    });
  });

  it('restores the page shown last, not an older one', async () => {
    await page();
    request('https://www.example.com/next', 2_000);
    headers('https://www.example.com/next');
    request('https://www.example.com/next.pdf', 3_000);
    headers('https://www.example.com/next.pdf', 204);
    expect(await mod.getNav(TAB)).toMatchObject({
      url: 'https://www.example.com/next',
      startedAt: 2_000,
    });
  });
});

describe('Set-Cookie', () => {
  it('stores the cookie name and attributes, never the value', async () => {
    request('https://www.example.com/');
    headers('https://www.example.com/', 200, [
      { name: 'Set-Cookie', value: 'sid=s3cr3t-token; Path=/; HttpOnly; Secure; SameSite=Lax' },
      { name: 'set-cookie', value: 'theme=dark' },
      { name: 'set-cookie', value: 'nameless-s3cr3t; Path=/' },
      { name: 'set-cookie', value: 'bare-s3cr3t' },
      { name: 'X-Note', value: 'sid=not-a-cookie' },
    ]);
    const expected = [
      ['Set-Cookie', 'sid=…; Path=/; HttpOnly; Secure; SameSite=Lax'],
      ['set-cookie', 'theme=…'],
      ['set-cookie', '…; Path=/'],
      ['set-cookie', '…'],
      ['X-Note', 'sid=not-a-cookie'],
    ];
    expect((await mod.getNav(TAB))!.headers).toEqual(expected);
    await flush();
    expect((await stored())!.headers).toEqual(expected);
    expect(JSON.stringify(await fakeBrowser.storage.session.get(null))).not.toContain('s3cr3t');
  });
});

describe('prerendered pages', () => {
  const pre = { documentLifecycle: 'prerender' };
  const tabAt = (url: string) => {
    fakeBrowser.tabs.get = vi.fn(async () => ({ id: TAB, url })) as never;
  };

  it('keeps the page on screen when speculation rules prerender a link', async () => {
    request('https://www.example.com/', 1_000);
    headers('https://www.example.com/');
    tabAt('https://www.example.com/');
    on.onBeforeRequest({
      tabId: TAB,
      url: 'https://www.example.com/next',
      timeStamp: 2_000,
      requestId: 'p1',
      ...pre,
    });
    on.onHeadersReceived({
      tabId: TAB,
      url: 'https://www.example.com/next',
      statusCode: 404,
      statusLine: 'HTTP/1.1 404 Not Found',
      requestId: 'p1',
      ...pre,
    });
    expect(await mod.getNav(TAB)).toMatchObject({ url: 'https://www.example.com/', status: 200 });
    await flush();
    expect((await stored())!.url).toBe('https://www.example.com/');
  });

  it('uses the prerendered response once the tab shows it, redirects included', async () => {
    request('https://www.example.com/', 1_000);
    headers('https://www.example.com/');
    on.onBeforeRequest({
      tabId: TAB,
      url: 'https://www.example.com/old',
      timeStamp: 2_000,
      requestId: 'p1',
      ...pre,
    });
    on.onBeforeRedirect({
      tabId: TAB,
      url: 'https://www.example.com/old',
      redirectUrl: 'https://www.example.com/new',
      statusCode: 301,
      statusLine: 'HTTP/1.1 301 Moved Permanently',
      requestId: 'p1',
      ...pre,
    });
    on.onBeforeRequest({
      tabId: TAB,
      url: 'https://www.example.com/new',
      timeStamp: 2_010,
      requestId: 'p1',
      ...pre,
    });
    on.onHeadersReceived({
      tabId: TAB,
      url: 'https://www.example.com/new',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      responseHeaders: [{ name: 'X-Page', value: 'new' }],
      requestId: 'p1',
      ...pre,
    });
    tabAt('https://www.example.com/new#intro');
    expect(await mod.getNav(TAB)).toEqual(
      record({
        url: 'https://www.example.com/new',
        status: 200,
        statusLine: 'HTTP/1.1 200 OK',
        headers: [['X-Page', 'new']],
        redirects: [
          {
            url: 'https://www.example.com/old',
            status: 301,
            location: 'https://www.example.com/new',
          },
        ],
        startedAt: 2_000,
      }),
    );
    await flush();
    expect((await stored())!.url).toBe('https://www.example.com/new');
  });

  it('keeps a navigation that started while the tab was being looked up', async () => {
    request('https://www.example.com/', 1_000);
    headers('https://www.example.com/');
    on.onBeforeRequest({
      tabId: TAB,
      url: 'https://www.example.com/next',
      timeStamp: 2_000,
      requestId: 'p1',
      ...pre,
    });
    on.onHeadersReceived({
      tabId: TAB,
      url: 'https://www.example.com/next',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      requestId: 'p1',
      ...pre,
    });
    // The tab still shows the prerendered URL, but a new navigation starts during tabs.get.
    fakeBrowser.tabs.get = vi.fn(async () => {
      request('https://www.example.com/other', 3_000);
      return { id: TAB, url: 'https://www.example.com/next' };
    }) as never;
    expect((await mod.getNav(TAB))!.url).toBe('https://www.example.com/');
    expect((await mod.getNav(TAB))!.url).toBe('https://www.example.com/other');
  });

  it('copes with a tab that closed meanwhile', async () => {
    request('https://www.example.com/', 1_000);
    headers('https://www.example.com/');
    on.onBeforeRequest({
      tabId: TAB,
      url: 'https://www.example.com/next',
      timeStamp: 2_000,
      requestId: 'p1',
      ...pre,
    });
    on.onHeadersReceived({
      tabId: TAB,
      url: 'https://www.example.com/next',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      requestId: 'p1',
      ...pre,
    });
    fakeBrowser.tabs.get = vi.fn(async () =>
      Promise.reject(new Error('No tab with id: 4')),
    ) as never;
    expect(await mod.getNav(TAB)).toMatchObject({ url: 'https://www.example.com/' });
  });
});

describe('client redirects', () => {
  it('flags a committed top frame with the client_redirect qualifier and saves it', async () => {
    request('https://www.example.com/old');
    const commit = (frameId: number, transitionQualifiers: string[]) =>
      fakeBrowser.webNavigation.onCommitted.trigger({
        tabId: TAB,
        frameId,
        url: 'https://www.example.com/old',
        transitionQualifiers,
      } as never);
    await commit(1, ['client_redirect']);
    expect((await mod.getNav(TAB))!.clientRedirect).toBe(false);
    await commit(0, ['from_address_bar']);
    expect((await mod.getNav(TAB))!.clientRedirect).toBe(false);
    await commit(0, ['client_redirect']);
    expect((await mod.getNav(TAB))!.clientRedirect).toBe(true);
    await flush();
    expect((await stored())!.clientRedirect).toBe(true);
  });

  it('ignores a commit without a record', async () => {
    await fakeBrowser.webNavigation.onCommitted.trigger({
      tabId: 99,
      frameId: 0,
      url: 'https://www.example.com/',
      transitionQualifiers: ['client_redirect'],
    } as never);
    expect(await mod.getNav(99)).toBeNull();
  });
});

// A page its service worker answers (from its cache, or by its own fetch) makes no main-frame
// request, so the tab commits it without a record of its own.
describe('a navigation webRequest did not see', () => {
  const commit = (url: string) =>
    fakeBrowser.webNavigation.onCommitted.trigger({
      tabId: TAB,
      frameId: 0,
      url,
      transitionQualifiers: [],
    } as never);

  it('drops the record of the page before, from memory and storage', async () => {
    request('https://www.example.com/');
    headers('https://www.example.com/', 200, [{ name: 'X-Robots-Tag', value: 'noindex' }]);
    await commit('https://www.example.com/');
    await flush();
    await commit('https://www.example.com/cached');
    await flush();
    expect(await mod.getNav(TAB)).toBeNull();
    expect(await stored()).toBeUndefined();
  });

  it('drops a stored record after a worker restart', async () => {
    request('https://www.example.com/');
    headers('https://www.example.com/');
    await flush();
    await start();
    await commit('https://www.example.com/cached');
    await flush();
    expect(await mod.getNav(TAB)).toBeNull();
  });

  it('keeps the record of the page committed, whatever its fragment', async () => {
    request('https://www.example.com/');
    headers('https://www.example.com/');
    await commit('https://www.example.com/#top');
    await flush();
    expect(await mod.getNav(TAB)).toMatchObject({ url: 'https://www.example.com/', status: 200 });
  });
});

describe('closing a tab', () => {
  it('drops the record from memory and storage', async () => {
    request('https://www.example.com/');
    headers('https://www.example.com/');
    await flush();
    await fakeBrowser.tabs.onRemoved.trigger(TAB, { windowId: 1, isWindowClosing: false });
    await flush();
    expect(await mod.getNav(TAB)).toBeNull();
    expect(await stored()).toBeUndefined();
  });
});

describe('getNav after a worker restart', () => {
  it('reads the record back from storage.session and keeps extending it', async () => {
    request('https://www.example.com/');
    headers('https://www.example.com/');
    await flush();
    const before = await mod.getNav(TAB);

    await start(); // a fresh module has nothing in memory
    expect(await mod.getNav(TAB)).toEqual(before);
    await fakeBrowser.webNavigation.onCommitted.trigger({
      tabId: TAB,
      frameId: 0,
      url: 'https://www.example.com/',
      transitionQualifiers: ['client_redirect'],
    } as never);
    expect((await mod.getNav(TAB))!.clientRedirect).toBe(true);
  });

  it('is null for a tab never seen', async () => {
    expect(await mod.getNav(123)).toBeNull();
  });
});
