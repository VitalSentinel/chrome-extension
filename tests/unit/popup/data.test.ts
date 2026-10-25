import { render, screen, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabContext } from '../../../src/lib/messages';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../../src/lib/settings';
import { nav, snap } from '../fixtures';

type Data = typeof import('../../../src/popup/data');
type Exec = {
  target: { tabId: number };
  files?: string[];
  func?: (...a: unknown[]) => unknown;
  args?: unknown[];
  world?: string;
};

let data: Data;
let executeScript: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
/** Site responses by URL; anything else is a 404. */
let site: Record<string, () => Response | Promise<Response>>;

const text = (body: string, contentType = 'text/plain', status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': contentType } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const xml = (body: string) =>
  text(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, 'application/xml');
const urlset = (...locs: string[]) =>
  xml(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`,
  );
const sitemapIndex = (...locs: string[]) =>
  xml(
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`,
  );
const fetched = () =>
  fetchMock.mock.calls.map(([u, init]) => ({ url: String(u), init: init as RequestInit }));

const ctx = (overrides: Partial<TabContext> = {}): TabContext =>
  ({
    tabId: 1,
    url: 'https://www.example.com/page',
    title: '',
    incognito: false,
    nav: nav(),
    vitals: null,
    js: 'allow',
    auth: { signedIn: false, workspaces: [], roles: {} },
    monitored: null,
    ...overrides,
  }) as TabContext;

beforeEach(async () => {
  fakeBrowser.reset();
  vi.resetModules(); // empties the popup's memo
  data = await import('../../../src/popup/data');
  site = {};
  fetchMock = vi.fn(async (u: string) =>
    (site[String(u)] ?? (() => text('Not found', 'text/html', 404)))(),
  );
  vi.stubGlobal('fetch', fetchMock);
  // Runs the injected function in this document, the way Chrome runs it in the page.
  executeScript = vi.fn(async ({ files, func, args }: Exec) =>
    files ? [] : [{ frameId: 0, result: await func!(...(args ?? [])) }],
  );
  fakeBrowser.scripting.executeScript = executeScript as never;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).__vsSnapshot;
  delete (globalThis as Record<string, unknown>).__vsAxe;
  delete (window as unknown as Record<string, unknown>).dataLayer;
});

describe('snapshot and memoisation', () => {
  it('injects the analyser once and reuses the result', async () => {
    const page = snap({ title: 'Pricing' });
    (globalThis as Record<string, unknown>).__vsSnapshot = vi.fn(() => page);
    expect(await data.snapshot(5)).toEqual(page);
    expect(await data.snapshot(5)).toEqual(page);
    expect(executeScript).toHaveBeenCalledTimes(2); // the file, then the function – once
    expect(executeScript.mock.calls[0][0]).toEqual({
      target: { tabId: 5 },
      files: ['/analyser.js'],
    });
  });

  it('does not memoise a failure', async () => {
    (globalThis as Record<string, unknown>).__vsSnapshot = () => undefined;
    await expect(data.snapshot(5)).rejects.toThrow('This page cannot be analysed.');
    (globalThis as Record<string, unknown>).__vsSnapshot = () => snap();
    await expect(data.snapshot(5)).resolves.toEqual(snap());
  });

  it('forgets entries by prefix', async () => {
    (globalThis as Record<string, unknown>).__vsSnapshot = () => snap();
    await data.snapshot(5);
    await data.snapshot(6);
    data.forget('snap:5');
    await data.snapshot(5);
    await data.snapshot(6);
    expect(executeScript).toHaveBeenCalledTimes(6);
  });
});

describe('useAsync', () => {
  function Probe({ load, dep }: { load: () => Promise<string>; dep: number }) {
    const s = data.useAsync(load, [dep]);
    return h('p', null, s.loading ? 'loading' : s.error ? `error: ${s.error}` : `data: ${s.data}`);
  }

  it('goes from loading to data', async () => {
    render(h(Probe, { load: async () => 'ready', dep: 1 }));
    expect(screen.getByText('loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('data: ready')).toBeTruthy());
  });

  it('shows the error message', async () => {
    render(h(Probe, { load: async () => Promise.reject(new Error('CrUX API 500')), dep: 1 }));
    await waitFor(() => expect(screen.getByText('error: CrUX API 500')).toBeTruthy());
  });

  it('reloads when a dependency changes and ignores the stale answer', async () => {
    let resolveFirst!: (v: string) => void;
    const first = () => new Promise<string>((r) => (resolveFirst = r));
    const { rerender } = render(h(Probe, { load: first, dep: 1 }));
    rerender(h(Probe, { load: async () => 'second', dep: 2 }));
    await waitFor(() => expect(screen.getByText('data: second')).toBeTruthy());
    resolveFirst('first');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('data: second')).toBeTruthy();
  });
});

describe('tab and settings', () => {
  it('reads the tab from ?tab= (the popup opened in a window)', async () => {
    vi.stubGlobal('location', new URL('chrome-extension://test-extension-id/popup.html?tab=42'));
    expect(await data.currentTabId()).toBe(42);
  });

  it('otherwise uses the active tab of the current window', async () => {
    vi.stubGlobal('location', new URL('chrome-extension://test-extension-id/popup.html'));
    const query = vi.fn(async () => [{ id: 17, url: 'https://www.example.com/', active: true }]);
    fakeBrowser.tabs.query = query as never;
    expect(await data.currentTabId()).toBe(17);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('fails without an active tab', async () => {
    vi.stubGlobal('location', new URL('chrome-extension://test-extension-id/popup.html'));
    fakeBrowser.tabs.query = vi.fn(async () => []) as never;
    await expect(data.currentTabId()).rejects.toThrow('No active tab');
  });

  it('asks the worker for the tab context', async () => {
    const sendMessage = vi.fn(async () => ctx());
    fakeBrowser.runtime.sendMessage = sendMessage as never;
    expect(await data.context(3)).toEqual(ctx());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'tab:context', tabId: 3 });
  });

  it('reads settings with defaults and saves a patch', async () => {
    expect(await data.settings()).toEqual(DEFAULT_SETTINGS);
    expect(await data.saveSettings({ offline: true })).toEqual({
      ...DEFAULT_SETTINGS,
      offline: true,
    });
    expect(await data.saveSettings({ rememberChanges: false })).toEqual({
      ...DEFAULT_SETTINGS,
      offline: true,
      rememberChanges: false,
    });
    expect((await fakeBrowser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]).toMatchObject({
      offline: true,
      rememberChanges: false,
    });
  });
});

describe('fetchText', () => {
  it('fetches without cookies or cache and memoises by method, headers and URL', async () => {
    site['https://www.example.com/a'] = () => text('hello', 'text/plain; charset=utf-8');
    const r = await data.fetchText('https://www.example.com/a');
    expect(r).toEqual({
      status: 200,
      text: 'hello',
      contentType: 'text/plain; charset=utf-8',
      url: '',
      bytes: 5,
    });
    await data.fetchText('https://www.example.com/a');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetched()[0].init).toMatchObject({
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
    });
    expect(fetched()[0].init.signal).toBeInstanceOf(AbortSignal);
    await data.fetchText('https://www.example.com/a', { method: 'HEAD' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not read the body of a HEAD request', async () => {
    site['https://www.example.com/a'] = () => text('ignored');
    expect((await data.fetchText('https://www.example.com/a', { method: 'HEAD' })).text).toBe('');
  });

  it('memoises a manual-redirect fetch separately from a followed one', async () => {
    site['https://www.example.com/a'] = () => text('hello');
    await data.fetchText('https://www.example.com/a');
    await data.fetchText('https://www.example.com/a', { redirect: 'manual' });
    await data.fetchText('https://www.example.com/a', { redirect: 'manual' });
    expect(fetched().map((c) => c.init.redirect)).toEqual(['follow', 'manual']);
  });
});

describe('robots', () => {
  const ROBOTS =
    'User-agent: *\nDisallow: /admin\n\nSitemap: https://www.example.com/sitemap.xml\n';

  it('parses a robots.txt', async () => {
    site['https://www.example.com/robots.txt'] = () => text(ROBOTS);
    const r = (await data.robots('https://www.example.com'))!;
    expect(r.status).toBe(200);
    expect(r.text).toBe(ROBOTS);
    expect(r.parsed.sitemaps).toEqual(['https://www.example.com/sitemap.xml']);
    expect(r.parsed.groups).toHaveLength(1);
  });

  it.each([
    {
      name: 'an HTML page served with 200',
      res: () => text('<!doctype html><title>Home</title>', 'text/html; charset=utf-8'),
      status: 200,
    },
    { name: 'a 404', res: () => text('Not found', 'text/plain', 404), status: 404 },
  ])('treats $name as empty', async ({ res, status }) => {
    site['https://www.example.com/robots.txt'] = res;
    expect(await data.robots('https://www.example.com')).toEqual({
      status,
      text: '',
      parsed: { groups: [], sitemaps: [] },
    });
  });

  it('is null when the fetch fails', async () => {
    site['https://www.example.com/robots.txt'] = () =>
      Promise.reject(new TypeError('Failed to fetch'));
    expect(await data.robots('https://www.example.com')).toBeNull();
  });

  it('treats a server error as disallowing everything, as Google does', async () => {
    site['https://www.example.com/robots.txt'] = () => text('Oops', 'text/plain', 503);
    const r = (await data.robots('https://www.example.com'))!;
    expect(r.status).toBe(503);
    expect(r.text).toBe('');
    expect(r.parsed.groups).toEqual([{ agents: ['*'], rules: [{ allow: false, path: '/' }] }]);
  });

  it('reads only the first 500 KiB, like Google', async () => {
    const big = `User-agent: *\nDisallow: /a\n${'#'.repeat(600 * 1024)}\nDisallow: /late`;
    site['https://www.example.com/robots.txt'] = () => text(big);
    const r = (await data.robots('https://www.example.com'))!;
    expect(r.text.length).toBe(500 * 1024);
    expect(r.parsed.groups[0].rules.map((x) => x.path)).toEqual(['/a']);
  });
});

describe('sitemaps', () => {
  const PAGE = 'https://www.example.com/blog/post-1';

  it('follows robots.txt sitemaps, relative ones too, one index level deep', async () => {
    site['https://www.example.com/robots.txt'] = () =>
      text('Sitemap: /sitemap_index.xml\nSitemap: https://www.example.com/news.xml');
    site['https://www.example.com/sitemap_index.xml'] = () =>
      sitemapIndex('https://www.example.com/posts.xml', 'https://www.example.com/pages.xml');
    site['https://www.example.com/news.xml'] = () => urlset('https://www.example.com/news/1');
    site['https://www.example.com/posts.xml'] = () =>
      urlset('https://www.example.com/blog/post-1/', 'https://www.example.com/blog/post-2');
    site['https://www.example.com/pages.xml'] = () =>
      Promise.reject(new TypeError('Failed to fetch'));

    expect(await data.sitemaps(PAGE)).toEqual({
      sources: [
        { url: 'https://www.example.com/sitemap_index.xml', status: 200, kind: 'index', count: 2 },
        { url: 'https://www.example.com/news.xml', status: 200, kind: 'urlset', count: 1 },
        { url: 'https://www.example.com/posts.xml', status: 200, kind: 'urlset', count: 2 },
        { url: 'https://www.example.com/pages.xml', status: 0, kind: 'unknown', count: 0 },
      ],
      listed: true,
    });
  });

  it('tries the default locations without a declared sitemap and reports an unlisted page', async () => {
    site['https://www.example.com/sitemap.xml'] = () =>
      urlset('https://www.example.com/', 'https://www.example.com/about');
    const r = await data.sitemaps(PAGE);
    expect(r.listed).toBe(false);
    expect(r.sources.map((s) => [s.url, s.status, s.kind])).toEqual([
      ['https://www.example.com/sitemap.xml', 200, 'urlset'],
      ['https://www.example.com/sitemap_index.xml', 404, 'unknown'],
    ]);
  });

  it('is null for listed when no urlset was found', async () => {
    expect((await data.sitemaps(PAGE)).listed).toBeNull();
  });

  it('hands out an earlier check without fetching anything itself', async () => {
    site['https://www.example.com/sitemap.xml'] = () =>
      urlset('https://www.example.com/blog/post-1');
    expect(await data.sitemapsIfChecked(PAGE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    const checked = await data.sitemaps(PAGE);
    expect(await data.sitemapsIfChecked(PAGE)).toBe(checked);
  });

  it('fetches public http(s) sitemaps and skips local or non-http ones', async () => {
    site['https://www.example.com/robots.txt'] = () =>
      text(
        [
          'Sitemap: https://cdn.example.com/sitemap.xml',
          'Sitemap: http://localhost:8080/sitemap.xml',
          'Sitemap: ftp://www.example.com/sitemap.xml',
          'Sitemap: http://[::1',
        ].join('\n'),
      );
    site['https://cdn.example.com/sitemap.xml'] = () =>
      sitemapIndex('/posts.xml', 'http://169.254.169.254/latest/meta-data/');
    site['https://www.example.com/posts.xml'] = () => urlset(PAGE);

    const r = await data.sitemaps(PAGE);
    expect(r.sources.map((s) => [s.url, s.kind])).toEqual([
      ['https://cdn.example.com/sitemap.xml', 'index'],
      ['http://localhost:8080/sitemap.xml', 'skipped'],
      ['ftp://www.example.com/sitemap.xml', 'skipped'],
      ['https://www.example.com/posts.xml', 'urlset'], // a relative child, resolved
      ['http://169.254.169.254/latest/meta-data/', 'skipped'],
    ]);
    expect(r.listed).toBe(true);
    const hosts = fetched().map((c) => new URL(c.url).hostname);
    expect(hosts).not.toContain('localhost');
    expect(hosts).not.toContain('169.254.169.254');
  });

  it('stops after 20 sitemap requests and reads each file once', async () => {
    const children = Array.from({ length: 30 }, (_, i) => `https://www.example.com/index-${i}.xml`);
    site['https://www.example.com/robots.txt'] = () =>
      text([1, 2, 3, 4, 5, 6].map((i) => `Sitemap: /root-${i}.xml`).join('\n'));
    for (let i = 1; i <= 6; i++)
      site[`https://www.example.com/root-${i}.xml`] = () => sitemapIndex(...children);
    const r = await data.sitemaps(PAGE);
    expect(r.sources).toHaveLength(20);
    expect(fetchMock).toHaveBeenCalledTimes(21); // robots.txt and 20 sitemaps
    expect(new Set(r.sources.map((s) => s.url)).size).toBe(20);
    // Only the first five declared sitemaps are read.
    expect(r.sources.some((s) => s.url.endsWith('root-6.xml'))).toBe(false);
  });

  it('follows an index of indexes two levels deep, no further', async () => {
    site['https://www.example.com/sitemap.xml'] = () =>
      sitemapIndex('https://www.example.com/level-1.xml');
    site['https://www.example.com/level-1.xml'] = () =>
      sitemapIndex('https://www.example.com/level-2.xml');
    site['https://www.example.com/level-2.xml'] = () =>
      sitemapIndex('https://www.example.com/level-3.xml');
    site['https://www.example.com/level-3.xml'] = () => urlset(PAGE);
    const r = await data.sitemaps(PAGE);
    expect(r.sources.map((s) => s.url.split('/').pop())).toEqual([
      'sitemap.xml',
      'sitemap_index.xml',
      'level-1.xml',
      'level-2.xml',
    ]);
  });

  it('reads 50,000-URL files under a <sitemap> root and finds the page (dennikn.sk)', async () => {
    const locs = Array.from({ length: 50_000 }, (_, i) => `https://www.example.com/blog/${i}/`);
    locs[49_000] = `${PAGE}/`;
    site['https://www.example.com/robots.txt'] = () => text('Sitemap: /api/sitemap/root');
    site['https://www.example.com/api/sitemap/root'] = () =>
      sitemapIndex('https://www.example.com/sitemap.year.2026.xml');
    site['https://www.example.com/sitemap.year.2026.xml'] = () =>
      text(
        `<sitemap xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</sitemap>`,
        'text/xml',
      );
    const r = await data.sitemaps(PAGE);
    expect(r.sources[1]).toEqual({
      url: 'https://www.example.com/sitemap.year.2026.xml',
      status: 200,
      kind: 'urlset',
      count: 50_000,
    });
    expect(r.listed).toBe(true);
  });

  it('inflates a gzipped sitemap', async () => {
    const xmlBody = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PAGE}</loc></url></urlset>`;
    const gz = await new Response(
      new Blob([xmlBody]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    site['https://www.example.com/robots.txt'] = () => text('Sitemap: /sitemap.xml.gz');
    site['https://www.example.com/sitemap.xml.gz'] = () =>
      new Response(gz, { headers: { 'Content-Type': 'application/x-gzip' } });
    const r = await data.sitemaps(PAGE);
    expect(r.sources).toEqual([
      { url: 'https://www.example.com/sitemap.xml.gz', status: 200, kind: 'urlset', count: 1 },
    ]);
    expect(r.listed).toBe(true);
  });

  it('fetches the files of one level in parallel, two at a time', async () => {
    const children = Array.from({ length: 10 }, (_, i) => `https://www.example.com/s-${i}.xml`);
    site['https://www.example.com/sitemap.xml'] = () => sitemapIndex(...children);
    let active = 0;
    let peak = 0;
    for (const c of children)
      site[c] = async () => {
        peak = Math.max(peak, ++active);
        await new Promise((res) => setTimeout(res, 5));
        active--;
        return urlset('https://www.example.com/x');
      };
    await data.sitemaps(PAGE);
    expect(peak).toBe(2);
  });
});

describe('rawSnapshot', () => {
  it('parses the HTML a crawler gets', async () => {
    const html =
      '<!doctype html><html lang="de"><head><title>Preise</title><meta name="robots" content="noindex"></head><body><h1>Preise</h1><a href="/kontakt">Kontakt</a></body></html>';
    site['https://www.example.com/preise'] = () => text(html, 'text/html; charset=utf-8');
    const r = await data.rawSnapshot('https://www.example.com/preise');
    expect(r.status).toBe(200);
    expect(r.snapshot).toMatchObject({ title: 'Preise', lang: 'de', htmlBytes: html.length });
    expect(r.snapshot!.links.map((l) => l.href)).toEqual(['https://www.example.com/kontakt']);
    expect(r.snapshot!.meta).toContainEqual({ key: 'robots', content: 'noindex' });
  });

  it('decodes the charset the page declares, not always UTF-8', async () => {
    // "Žilina – úvod" in windows-1250, declared only in a <meta> tag.
    const head = '<html><head><meta charset="windows-1250"><title>';
    const bytes = new Uint8Array([
      ...new TextEncoder().encode(head),
      0x8e,
      0x69,
      0x6c,
      0x69,
      0x6e,
      0x61,
      0x20,
      0x96,
      0x20,
      0xfa,
      0x76,
      0x6f,
      0x64,
      ...new TextEncoder().encode('</title></head><body></body></html>'),
    ]);
    site['https://www.example.com/sk'] = () =>
      new Response(bytes, { headers: { 'Content-Type': 'text/html' } });
    const r = await data.rawSnapshot('https://www.example.com/sk');
    expect(r.snapshot!.title).toBe('Žilina – úvod');
    expect(r.snapshot!.htmlBytes).toBe(bytes.length);
  });

  it('prefers the charset in the Content-Type header', async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('<title>caf'),
      0xe9,
      ...new TextEncoder().encode('</title>'),
    ]);
    site['https://www.example.com/fr'] = () =>
      new Response(bytes, { headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' } });
    expect((await data.rawSnapshot('https://www.example.com/fr')).snapshot!.title).toBe('café');
  });

  it('sniffs HTML served without a Content-Type', async () => {
    site['https://www.example.com/bare'] = () =>
      new Response('<!DOCTYPE html><title>Bare</title>', { headers: { 'Content-Type': '' } });
    expect((await data.rawSnapshot('https://www.example.com/bare')).snapshot?.title).toBe('Bare');
  });

  it('has no snapshot for a non-HTML response', async () => {
    site['https://www.example.com/feed'] = () => json({ items: [] });
    expect(await data.rawSnapshot('https://www.example.com/feed')).toEqual({
      status: 200,
      snapshot: null,
    });
  });
});

describe('probe', () => {
  it('reports present globals and the consent commands in the dataLayer', async () => {
    const w = window as unknown as Record<string, unknown>;
    w.dataLayer = [
      { event: 'gtm.js' },
      ['consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' }],
      // gtag() pushes its `arguments` object, which is array-like.
      (function (..._a: unknown[]) {
        // eslint-disable-next-line prefer-rest-params
        return arguments;
      })('consent', 'update', { analytics_storage: 'granted' }),
    ];
    w.__NEXT_DATA__ = { page: '/' };
    w.jQuery = () => {};
    const r = await data.probe(2);
    expect(r.globals).toEqual(expect.arrayContaining(['__NEXT_DATA__', 'jQuery']));
    expect(r.globals).not.toContain('Shopify');
    expect(r.consentMode).toEqual({
      defaults: { ad_storage: 'denied', analytics_storage: 'denied' },
      updates: { analytics_storage: 'granted' },
    });
    expect(executeScript.mock.calls[0][0]).toMatchObject({ target: { tabId: 2 }, world: 'MAIN' });
    delete w.__NEXT_DATA__;
    delete w.jQuery;
  });

  it('copes with a page that cannot be scripted', async () => {
    executeScript.mockResolvedValue([]);
    expect(await data.probe(2)).toEqual({ globals: [], consentMode: null });
  });
});

describe('cookies', () => {
  it('maps cookies to rows with a purpose', async () => {
    const getAll = vi.fn(async () => [
      {
        name: '_ga',
        domain: '.example.com',
        secure: true,
        httpOnly: false,
        sameSite: 'lax',
        session: false,
        expirationDate: 1_830_000_000,
      },
      {
        name: 'PHPSESSID',
        domain: 'www.example.com',
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        session: true,
      },
    ]);
    fakeBrowser.cookies.getAll = getAll as never;
    fakeBrowser.cookies.getAllCookieStores = vi.fn(async () => [
      { id: '0', tabIds: [1, 2] },
      { id: '1', tabIds: [9] }, // the incognito store
    ]) as never;
    const rows = await data.cookies('https://www.example.com/', 9);
    expect(getAll).toHaveBeenCalledWith({ url: 'https://www.example.com/', storeId: '1' });
    expect(rows).toEqual([
      {
        name: '_ga',
        domain: '.example.com',
        purpose: 'analytics',
        secure: true,
        httpOnly: false,
        sameSite: 'lax',
        session: false,
        expires: 1_830_000_000,
      },
      {
        name: 'PHPSESSID',
        domain: 'www.example.com',
        purpose: expect.any(String),
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        session: true,
        expires: null,
      },
    ]);
  });

  it('falls back to the default store when no store lists the tab', async () => {
    const getAll = vi.fn(async () => []);
    fakeBrowser.cookies.getAll = getAll as never;
    fakeBrowser.cookies.getAllCookieStores = vi.fn(async () => [{ id: '0', tabIds: [1] }]) as never;
    expect(await data.cookies('https://www.example.com/', 5)).toEqual([]);
    expect(getAll).toHaveBeenCalledWith({ url: 'https://www.example.com/' });
  });
});

describe('runAxe and overlay', () => {
  const result = {
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        help: 'Images must have alt text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: [],
        count: 3,
      },
    ],
    passes: 40,
    passIds: [],
  };

  it('injects axe, runs it once and again when asked for a fresh run', async () => {
    (globalThis as Record<string, unknown>).__vsAxe = vi.fn(async () => result);
    expect(await data.runAxe(4)).toEqual(result);
    await data.runAxe(4);
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls[0][0]).toEqual({ target: { tabId: 4 }, files: ['/axe.js'] });
    await data.runAxe(4, true);
    expect(executeScript).toHaveBeenCalledTimes(4);
  });

  it('draws the overlay with the analyser already in the page', async () => {
    const draw = vi.fn(async () => ({ lcp: true, shifts: 2 }));
    (globalThis as Record<string, unknown>).__vsOverlay = draw;
    expect(await data.overlay(4, true)).toEqual({ lcp: true, shifts: 2 });
    expect(draw).toHaveBeenCalledWith(true);
    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript.mock.calls[0][0]).toMatchObject({ target: { tabId: 4 }, args: [true] });
    delete (globalThis as Record<string, unknown>).__vsOverlay;
  });

  it('injects the analyser first on a page loaded since (no content script needed)', async () => {
    const draw = vi.fn(async () => ({ lcp: false, shifts: 0 }));
    executeScript.mockImplementation(async ({ files, func, args }: Exec) => {
      if (files) (globalThis as Record<string, unknown>).__vsOverlay = draw;
      return files ? [] : [{ frameId: 0, result: await func!(...(args ?? [])) }];
    });
    expect(await data.overlay(4, false)).toEqual({ lcp: false, shifts: 0 });
    expect(executeScript.mock.calls.map(([c]) => (c as Exec).files ?? 'func')).toEqual([
      'func',
      ['/analyser.js'],
      'func',
    ]);
    delete (globalThis as Record<string, unknown>).__vsOverlay;
  });

  it('tells whether the overlay is on the page, quietly false for a closed tab', async () => {
    expect(await data.overlayShown(4)).toBe(false);
    const host = document.createElement('div');
    host.id = 'vitalsentinel-overlay';
    document.body.append(host);
    expect(await data.overlayShown(4)).toBe(true);
    host.remove();
    executeScript.mockRejectedValue(new Error('No tab with id: 4'));
    expect(await data.overlayShown(4)).toBe(false);
  });
});

describe('reloadTab', () => {
  const update = (tabId: number, status: string) =>
    fakeBrowser.tabs.onUpdated.trigger(tabId, { status } as never, { id: tabId } as never);

  it('waits for that tab to load again, then forgets what was read from the old page', async () => {
    (globalThis as Record<string, unknown>).__vsSnapshot = () => snap({ title: 'Old' });
    await data.snapshot(5);
    const reload = vi.fn(async () => undefined);
    fakeBrowser.tabs.reload = reload as never;
    let done = false;
    const p = data.reloadTab(5).then(() => (done = true));
    await Promise.resolve();
    expect(reload).toHaveBeenCalledWith(5);
    await update(5, 'complete'); // the old page, before the reload started
    await update(9, 'loading');
    await update(9, 'complete'); // another tab
    await update(5, 'loading');
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    await update(5, 'complete');
    await p;
    (globalThis as Record<string, unknown>).__vsSnapshot = () => snap({ title: 'New' });
    expect((await data.snapshot(5)).title).toBe('New');
  });

  it('gives up after the timeout and when the tab cannot be reloaded', async () => {
    fakeBrowser.tabs.reload = vi.fn(async () => undefined) as never;
    await data.reloadTab(5, 5);
    fakeBrowser.tabs.reload = vi.fn(async () => Promise.reject(new Error('No tab'))) as never;
    await data.reloadTab(5, 60_000);
  });

  it('stops waiting when the tab closes', async () => {
    fakeBrowser.tabs.reload = vi.fn(async () => undefined) as never;
    const p = data.reloadTab(5, 60_000);
    await fakeBrowser.tabs.onRemoved.trigger(5, { windowId: 1, isWindowClosing: false });
    await p;
  });
});

describe('offline mode', () => {
  const PAGE = 'https://www.example.com/blog/post-1';
  const redirected = () =>
    ({
      type: 'opaqueredirect',
      status: 0,
      headers: new Headers(),
      url: '',
      body: null,
    }) as unknown as Response;
  beforeEach(() => data.saveSettings({ offline: true }));

  it('reads sitemaps on the viewed host only, not on a CDN or a sibling host', async () => {
    site['https://www.example.com/robots.txt'] = () =>
      text(
        [
          'Sitemap: https://www.example.com/sitemap.xml',
          'Sitemap: https://cdn.example.net/sitemap.xml',
          'Sitemap: https://example.com/sitemap.xml',
        ].join('\n'),
      );
    site['https://www.example.com/sitemap.xml'] = () => urlset(PAGE);
    const r = await data.sitemaps(PAGE);
    expect(r.sources.map((s) => [s.url, s.kind])).toEqual([
      ['https://www.example.com/sitemap.xml', 'urlset'],
      ['https://cdn.example.net/sitemap.xml', 'skipped'],
      ['https://example.com/sitemap.xml', 'skipped'],
    ]);
    expect(fetched().map((c) => new URL(c.url).hostname)).toEqual([
      'www.example.com',
      'www.example.com',
    ]);
  });

  it('does not follow a redirect, which could lead to another host, and says so', async () => {
    site['https://www.example.com/preise'] = redirected;
    await expect(data.rawSnapshot('https://www.example.com/preise')).rejects.toThrow(
      'Redirect not followed in offline mode',
    );
    expect(fetched()[0].init.redirect).toBe('manual');
    site['https://www.example.com/llms.txt'] = redirected;
    await expect(data.fetchText('https://www.example.com/llms.txt')).rejects.toThrow(
      data.OFFLINE_REDIRECT,
    );
  });

  it('still reads a response that does not redirect', async () => {
    site['https://www.example.com/robots.txt'] = () => text('User-agent: *\nDisallow: /x');
    expect((await data.robots('https://www.example.com'))!.parsed.groups).toHaveLength(1);
  });
});

describe('linkStatuses', () => {
  const opaqueRedirect = () =>
    ({ status: 0, text: async () => '', headers: new Headers(), url: '' }) as unknown as Response;

  it('checks each http(s) link once, retrying refused HEAD requests with GET', async () => {
    site['https://www.example.com/ok'] = () => text('', 'text/html');
    site['https://www.example.com/moved'] = opaqueRedirect;
    site['https://legacy.example.org/no-head'] = () => text('', 'text/html', 405);
    site['https://www.example.com/down'] = () => Promise.reject(new TypeError('Failed to fetch'));
    const out = new Map<string, number>();
    await data.linkStatuses(
      [
        'https://www.example.com/ok',
        'https://www.example.com/ok',
        'mailto:hello@example.com',
        'https://www.example.com/moved',
        'https://legacy.example.org/no-head',
        'https://www.example.com/missing',
        'https://www.example.com/down',
      ],
      (url, status) => out.set(url, status),
    );
    expect(Object.fromEntries(out)).toEqual({
      'https://www.example.com/ok': 200,
      'https://www.example.com/moved': 300, // a manual redirect is opaque
      'https://legacy.example.org/no-head': 405, // GET answered 405 too
      'https://www.example.com/missing': 404,
      'https://www.example.com/down': 0,
    });
    const legacy = fetched().filter((c) => c.url === 'https://legacy.example.org/no-head');
    expect(legacy.map((c) => c.init.method ?? 'GET')).toEqual(['HEAD', 'GET']);
    expect(legacy.every((c) => c.init.redirect === 'manual')).toBe(true);
  });

  it('runs at most six requests at a time', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return text('', 'text/html');
    });
    const urls = Array.from({ length: 20 }, (_, i) => `https://www.example.com/p/${i}`);
    const seen: string[] = [];
    await data.linkStatuses(urls, (u) => seen.push(u));
    expect(peak).toBe(6);
    expect(seen.sort()).toEqual([...urls].sort());
  });

  it('retries a HEAD the server refuses with GET, but trusts other errors', async () => {
    site['https://shop.example.com/p'] = () =>
      text('', 'text/html', fetched().at(-1)!.init.method === 'HEAD' ? 403 : 200);
    site['https://www.example.com/gone'] = () => text('', 'text/html', 410);
    site['https://www.example.com/busy'] = () => text('', 'text/html', 503);
    const out = new Map<string, number>();
    await data.linkStatuses(
      [
        'https://shop.example.com/p',
        'https://www.example.com/gone',
        'https://www.example.com/missing',
        'https://www.example.com/busy',
      ],
      (url, status) => out.set(url, status),
    );
    expect(Object.fromEntries(out)).toEqual({
      'https://shop.example.com/p': 200,
      'https://www.example.com/gone': 410,
      'https://www.example.com/missing': 404,
      'https://www.example.com/busy': 503,
    });
    expect(fetched().map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'HEAD https://shop.example.com/p',
      'HEAD https://www.example.com/gone',
      'HEAD https://www.example.com/missing',
      'HEAD https://www.example.com/busy',
      'GET https://shop.example.com/p',
    ]);
  });

  it('requests a page once for links that differ only in the fragment', async () => {
    site['https://www.example.com/guide'] = () => text('', 'text/html');
    const out = new Map<string, number>();
    await data.linkStatuses(
      [
        'https://www.example.com/guide#a',
        'https://www.example.com/guide#b',
        'https://www.example.com/guide',
      ],
      (url, status) => out.set(url, status),
    );
    expect([...out.values()]).toEqual([200, 200, 200]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not download the body of a GET fallback', async () => {
    let pulled = 0;
    site['https://www.example.com/big'] = () =>
      new Response(
        new ReadableStream({
          pull(c) {
            pulled++;
            c.enqueue(new Uint8Array(64 * 1024));
            if (pulled > 100) c.close();
          },
        }),
        { status: 405 },
      );
    await data.linkStatuses(['https://www.example.com/big'], () => undefined);
    expect(pulled).toBeLessThan(5);
  });

  it('does not retry a HEAD that timed out', async () => {
    site['https://slow.example.com/'] = () =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    const out = new Map<string, number>();
    await data.linkStatuses(['https://slow.example.com/'], (url, status) => out.set(url, status));
    expect(out.get('https://slow.example.com/')).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('changesSinceLastVisit', () => {
  const page = (overrides = {}) =>
    snap({ url: 'https://www.example.com/page#top', title: 'Old title', ...overrides });

  it.each([
    { name: 'when disabled', enabled: false, c: ctx() },
    { name: 'in incognito', enabled: true, c: ctx({ incognito: true }) },
  ])('stores nothing $name', async ({ enabled, c }) => {
    expect(await data.changesSinceLastVisit(page(), c, enabled)).toBeNull();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('stores a digest on the first visit and diffs against it on the next', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    expect(await data.changesSinceLastVisit(page(), ctx(), true)).toBeNull();
    expect(
      (await fakeBrowser.storage.local.get('digest:https://www.example.com/page'))[
        'digest:https://www.example.com/page'
      ],
    ).toMatchObject({ at: 1_000, title: 'Old title', status: 200 });

    data.forget('digest:');
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const r = await data.changesSinceLastVisit(
      page({ title: 'New title' }),
      ctx({ nav: nav({ status: 404 }) }),
      true,
    );
    expect(r).toEqual({
      since: 1_000,
      changes: [
        { field: 'status', before: '200', after: '404' },
        { field: 'title', before: 'Old title', after: 'New title' },
      ],
    });
    vi.restoreAllMocks();
  });

  it('stores nothing once the history was switched off after the popup loaded', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { rememberChanges: false } });
    expect(await data.changesSinceLastVisit(page(), ctx(), true)).toBeNull();
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual([SETTINGS_KEY]);
  });
});

describe('digest index', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 25);
  const key = (i: number) => `digest:https://www.example.com/p/${i}`;

  it('keeps the newest 2,000 entries younger than 30 days, in order', () => {
    const index: [string, number][] = [
      ...Array.from({ length: 2_001 }, (_, i): [string, number] => [key(i), NOW - i * 60_000]),
    ];
    index.splice(5, 0, ['digest:https://www.example.com/stale', NOW - 31 * DAY]);
    const { keep, drop } = data.pruneIndex(index, NOW);
    expect(keep).toHaveLength(2_000);
    expect(keep[0]).toEqual([key(0), NOW]);
    expect(keep.at(-1)![0]).toBe(key(1_999));
    expect(drop).toEqual(['digest:https://www.example.com/stale', key(2_000)]);
  });

  it('keeps an entry exactly 30 days old', () => {
    expect(data.pruneIndex([[key(1), NOW - 30 * DAY]], NOW)).toEqual({
      keep: [[key(1), NOW - 30 * DAY]],
      drop: [],
    });
  });

  it('moves the visited page to the front and removes pruned digests from storage', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await fakeBrowser.storage.local.set({
      'digest-index': [
        [key(1), NOW - DAY],
        ['digest:https://www.example.com/page', NOW - 2 * DAY],
        [key(2), NOW - 40 * DAY],
      ],
      [key(1)]: { at: NOW - DAY },
      [key(2)]: { at: NOW - 40 * DAY },
      'digest:https://www.example.com/page': { at: NOW - 2 * DAY, title: 'Old' },
    });
    await data.changesSinceLastVisit(snap({ url: 'https://www.example.com/page' }), ctx(), true);
    const stored = await fakeBrowser.storage.local.get(null);
    expect(stored['digest-index']).toEqual([
      ['digest:https://www.example.com/page', NOW],
      [key(1), NOW - DAY],
    ]);
    expect(stored).not.toHaveProperty([key(2)]);
    expect(stored).toHaveProperty([key(1)]);
    vi.restoreAllMocks();
  });
});
