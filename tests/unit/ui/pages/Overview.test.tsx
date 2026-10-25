import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Overview from '../../../../src/popup/pages/Overview';
import {
  MONITORED,
  PAGE_URL,
  SIGNED_IN,
  mockSend,
  navRecord,
  pageSnap,
  renderPage,
  robotsResult,
  setupData,
  tabContext,
} from '../fixtures';
import { appOverview } from '../appOverview';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);
vi.mock('../../../../src/lib/messages', () => ({ send: vi.fn() }));

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
  mockSend();
});
afterEach(cleanup);

const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const kv = (s: HTMLElement, label: string) =>
  within(s).getByText(label).nextElementSibling!.textContent;
describe('a clean page', () => {
  it('shows the URL, the pill row, crawl and page facts and nothing to fix', async () => {
    renderPage(Overview);
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    expect(screen.getByText(PAGE_URL).className).toContain('mono');
    expect(screen.getAllByText('200 OK')).toHaveLength(2); // pill and Crawl › Status
    expect(screen.getByText('Indexable')).toBeTruthy();
    expect(screen.getByText('en')).toBeTruthy();
    expect(screen.getByText('1,250 words')).toBeTruthy();
    expect(screen.getByText('Loaded in 2.1 s · 57 KB')).toBeTruthy();
    expect(screen.queryByText(/redirect/)).toBeNull();

    const crawl = section('Crawl');
    expect(kv(crawl, 'Redirects')).toBe('None');
    expect(await within(crawl).findByText('Allowed for Googlebot')).toBeTruthy();
    expect(kv(crawl, 'Meta robots')).toBe('Not set (index, follow)');
    expect(kv(crawl, 'Sitemaps')).toBe('1 declared in robots.txt');

    const page = section('Page');
    expect(within(page).getByText('Core Web Vitals explained: a practical guide')).toBeTruthy();
    expect(within(page).getByText('44 characters').className).toContain('text-ink-2');
    expect(kv(page, 'Canonical')).toBe('Self-referencing');
    expect(kv(page, 'H1')).toBe('Core Web Vitals explained');
    expect(kv(page, 'Structured data')).toBe('Article');

    expect(screen.getByRole('heading', { name: 'Needs attention · 0' })).toBeTruthy();
    expect(screen.getByText('Nothing needs attention on this page.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start monitoring' })).toBeTruthy();
    expect(data.robots).toHaveBeenCalledWith('https://www.example.com');
    expect(data.changesSinceLastVisit).toHaveBeenCalledWith(
      expect.objectContaining({ url: PAGE_URL }),
      expect.anything(),
      true,
    );
  });

  it('opens Performance from the Core Web Vitals header', () => {
    const { props } = renderPage(Overview);
    fireEvent.click(screen.getByRole('link', { name: 'Performance ›' }));
    expect(props.go).toHaveBeenCalledWith('performance');
  });
});

describe('crawl facts', () => {
  it('counts redirect hops, reads a bare HTTP/2 status and a blocking robots.txt', async () => {
    data.robots.mockResolvedValue(robotsResult('User-agent: *\nDisallow: /blog/\n'));
    renderPage(Overview, {
      ctx: tabContext({
        nav: navRecord({
          statusLine: 'HTTP/2 200',
          redirects: [
            { url: 'http://example.com/', status: 301, location: '' },
            { url: 'https://example.com/', status: 302, location: '' },
          ],
        }),
      }),
      snap: pageSnap({ meta: [{ key: 'robots', content: 'noindex, follow' }] }),
    });
    expect(screen.getByText('2 redirects')).toBeTruthy();
    const crawl = section('Crawl');
    expect(kv(crawl, 'Status')).toBe('200 OK');
    expect(kv(crawl, 'Redirects')).toBe('2 hops (301, 302)');
    expect(kv(crawl, 'Meta robots')).toBe('noindex, follow');
    expect(await within(crawl).findByText(/Blocked for Googlebot by/)).toBeTruthy();
    expect(kv(crawl, 'Sitemaps')).toBe('None declared in robots.txt');
    expect(screen.getByText('Not indexable')).toBeTruthy();
  });

  it('explains a missing or unreadable robots.txt', async () => {
    data.robots.mockResolvedValue(robotsResult('', 404));
    const { unmount } = renderPage(Overview);
    expect(await screen.findByText('None (HTTP 404), so everything is allowed')).toBeTruthy();
    unmount();
    data.robots.mockResolvedValue(null);
    renderPage(Overview);
    expect(await screen.findByText('Could not be read')).toBeTruthy();
  });

  it('says a robots.txt server error stops Google crawling', async () => {
    data.robots.mockResolvedValue(robotsResult('', 503));
    renderPage(Overview);
    expect(await screen.findByText('HTTP 503, so Google crawls nothing on this site')).toBeTruthy();
  });
});

describe('CrUX data', () => {
  it('offers CrUX free with a verified domain and a PageSpeed Insights test, sending nothing', () => {
    renderPage(Overview);
    const cwv = section('Core Web Vitals');
    expect(within(cwv).getByText(/^Free CrUX data for /)).toBeTruthy();
    expect(within(cwv).getByRole('link', { name: 'Get CrUX free' }).getAttribute('href')).toContain(
      '/onboarding/domain?domain=example.com',
    );
    expect(
      within(cwv).getByRole('link', { name: 'Test on PageSpeed Insights ↗' }).getAttribute('href'),
    ).toBe(`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(PAGE_URL)}`);
  });
});

describe('a monitored site', () => {
  const ctx = tabContext({ auth: SIGNED_IN, monitored: MONITORED });

  it('adds the CrUX values, the monitoring strip and the watch button', async () => {
    const send = mockSend({ 'app:overview': () => ({ ok: true, data: appOverview() }) });
    const { props } = renderPage(Overview, { ctx });
    // While the app answers, the CrUX rows and the strip hold their space.
    expect(screen.getAllByRole('status', { name: 'Loading CrUX data' })).toHaveLength(3);
    expect(screen.getByText('Monitored in VitalSentinel · Last 90 days')).toBeTruthy();
    expect(screen.getByText(/Below: CrUX, the last 90 days/)).toBeTruthy();
    expect(await screen.findByText('12k')).toBeTruthy();
    expect(send).toHaveBeenCalledWith('app:overview', { domainId: 'dom1', url: PAGE_URL });
    expect(screen.queryByRole('status', { name: 'Loading CrUX data' })).toBeNull();
    const cwv = section('Core Web Vitals');
    expect(within(cwv).getByText('1.8 s')).toBeTruthy(); // this load still leads
    expect(within(cwv).getAllByText('CrUX data')).toHaveLength(3);
    expect(within(cwv).getAllByText('CrUX data')[0].nextElementSibling!.textContent).toBe('2.4 s');
    expect(within(cwv).getByText('No data')).toBeTruthy(); // INP has no CrUX week
    expect(within(cwv).queryByRole('img')).toBeNull(); // no trend charts
    expect(screen.queryByText(/Visitors p75/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start monitoring' })).toBeNull();
    expect(screen.queryByText(/^Free CrUX data for /)).toBeNull();
    expect(screen.getByRole('button', { name: 'Watch this page' })).toBeTruthy();

    const strip = screen
      .getByText('Monitored in VitalSentinel · Last 90 days')
      .closest('section') as HTMLElement;
    expect(within(strip).queryByText(/Acme/)).toBeNull();
    expect(within(strip).getByText('clicks').parentElement!.textContent).toBe('12kclicks');
    expect(within(strip).getByText('530k impressions')).toBeTruthy();
    expect(within(strip).getByText('Position 7.4')).toBeTruthy();
    expect(within(strip).getByText('Indexed').className).toContain('text-good-text');
    expect(within(strip).getByText('Last crawled Oct 20, 2026')).toBeTruthy();
    expect(within(strip).getByText('page views').parentElement!.textContent).toBe(
      '8,210page views',
    );
    expect(within(strip).getByText('Bounce rate 41.0%')).toBeTruthy();
    expect(within(strip).queryByText(/Alerts|open/)).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: /VitalSentinel tab/ }));
    expect(props.go).toHaveBeenCalledWith('vs-all');
  });

  it('opens the report behind each source in the strip', async () => {
    mockSend({ 'app:overview': () => ({ ok: true, data: appOverview() }) });
    const { props } = renderPage(Overview, { ctx });
    await screen.findByText('12k');
    const strip = screen
      .getByText('Monitored in VitalSentinel · Last 90 days')
      .closest('section') as HTMLElement;
    for (const [name, page] of [
      [/^Google Search Console/, 'content'],
      [/^Google index/, 'indexability'],
      [/^Web Analytics/, 'vs-all'],
    ] as const) {
      fireEvent.click(within(strip).getByRole('button', { name }));
      expect(props.go).toHaveBeenLastCalledWith(page);
    }
  });

  it('shows what the strip cannot know', async () => {
    const off = { status: 'not_connected' as const, as_of: null };
    mockSend({
      'app:overview': () => ({
        ok: true,
        data: appOverview({
          search_console: { ...appOverview().sections.search_console!, ...off },
          indexing: { ...appOverview().sections.indexing!, verdict: 'FAIL' },
          web_analytics: { ...appOverview().sections.web_analytics!, ...off },
        }),
      }),
    });
    renderPage(Overview, { ctx: tabContext({ ...ctx, auth: { ...SIGNED_IN, workspaces: [] } }) });
    expect(await screen.findByText('Not indexed')).toBeTruthy();
    const strip = screen
      .getByText('Monitored in VitalSentinel · Last 90 days')
      .closest('section') as HTMLElement;
    expect(within(strip).getAllByText('–')).toHaveLength(2);
    expect(within(strip).getByText('Not indexed').className).toContain('text-poor-text');
  });

  it('leaves a source the sign-in cannot read as a plain dash', async () => {
    const hidden = { status: 'not_in_scope' as const, as_of: null };
    mockSend({
      'app:overview': () => ({
        ok: true,
        data: appOverview({
          search_console: { ...appOverview().sections.search_console!, ...hidden },
          web_analytics: { ...appOverview().sections.web_analytics!, status: 'no_data' },
        }),
      }),
    });
    renderPage(Overview, { ctx });
    expect(await screen.findByText('Indexed')).toBeTruthy();
    const strip = screen
      .getByText('Monitored in VitalSentinel · Last 90 days')
      .closest('section') as HTMLElement;
    const cell = (name: RegExp) => within(strip).getByRole('button', { name });
    expect(cell(/^Google Search Console/).textContent).toBe('Google Search Console›–');
    expect(within(cell(/^Web Analytics/)).getByText('No data yet.')).toBeTruthy();
    expect(within(strip).getAllByText('No data yet.')).toHaveLength(1);
  });

  it('shows the coverage state when the verdict is neither pass nor fail', async () => {
    mockSend({
      'app:overview': () => ({
        ok: true,
        data: appOverview({
          indexing: { ...appOverview().sections.indexing!, verdict: 'NEUTRAL' },
        }),
      }),
    });
    renderPage(Overview, { ctx });
    expect(await screen.findByText('Submitted and indexed')).toBeTruthy();
  });

  it('falls back to the plain cards when the app has no CrUX data', async () => {
    const send = mockSend({
      'app:overview': () => ({
        ok: true,
        data: appOverview({ crux: { status: 'no_data', as_of: null, records: [] } }),
      }),
    });
    renderPage(Overview, { ctx });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(await screen.findByText('12k')).toBeTruthy();
    expect(screen.getByText('Monitored in VitalSentinel · Last 90 days')).toBeTruthy();
    expect(screen.getByText('1.8 s')).toBeTruthy();
    expect(screen.queryByText(/CrUX data$/)).toBeNull();
    expect(screen.queryByText(/Below: CrUX/)).toBeNull();
  });

  it('falls back to the plain cards when the app call fails', async () => {
    mockSend({ 'app:overview': () => ({ ok: false, status: 500, error: 'server' }) });
    renderPage(Overview, { ctx });
    expect(await screen.findByText('1.8 s')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Monitored in/)).toBeNull());
    expect(screen.queryByRole('status', { name: 'Loading CrUX data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Watch this page' })).toBeNull();
  });
});

describe('changed since the last visit', () => {
  it('shows before struck and after on two lines, then what stayed the same', async () => {
    data.changesSinceLastVisit.mockResolvedValue({
      since: Date.now() - 3 * 3600_000,
      changes: [
        {
          field: 'title',
          before: 'Old title',
          after: 'Core Web Vitals explained: a practical guide',
        },
        { field: 'description', before: '', after: 'New description' },
        { field: 'mystery' as never, before: 'a', after: '' },
      ],
    });
    renderPage(Overview);
    const changed = await waitFor(() => section('Changed since your last visit'));
    expect(within(changed).getByText('3 h ago · Stored in this browser')).toBeTruthy();
    expect(within(changed).getByText('Old title').className).toContain('line-through');
    expect(
      within(changed).getByText('Core Web Vitals explained: a practical guide').className,
    ).toContain('text-good-text');
    expect(within(changed).getByText('Meta description')).toBeTruthy();
    expect(within(changed).getByText('mystery')).toBeTruthy();
    expect(within(changed).getAllByText('Empty')).toHaveLength(2);
    expect(kv(changed, 'Unchanged')).toBe('canonical, robots, H1, schema');
  });

  it('says so when nothing changed', async () => {
    data.changesSinceLastVisit.mockResolvedValue({
      since: Date.now() - 5 * 86_400_000,
      changes: [],
    });
    renderPage(Overview);
    expect(await screen.findByText('Nothing SEO-relevant changed.')).toBeTruthy();
    expect(screen.getByText('5 days ago · Stored in this browser')).toBeTruthy();
  });

  it('notes when every tracked field changed', async () => {
    data.changesSinceLastVisit.mockResolvedValue({
      since: Date.now(),
      changes: ['title', 'description', 'canonical', 'robots', 'h1', 'schema'].map((f) => ({
        field: f as never,
        before: 'a',
        after: 'b',
      })),
    });
    renderPage(Overview);
    expect(await screen.findByText('nothing else we track')).toBeTruthy();
  });
});

describe('needs attention', () => {
  it('lists every issue, bad first, with the page that explains each', async () => {
    const snap = pageSnap({ title: '', meta: [], headings: [], canonicals: [] });
    const { props } = renderPage(Overview, {
      snap,
      ctx: tabContext({
        nav: navRecord({ status: 404, statusLine: 'HTTP/1.1 404 Not Found', headers: [] }),
      }),
    });
    expect(screen.getAllByText('404 Not Found')).toHaveLength(2);
    expect(screen.getByText('Not indexable')).toBeTruthy();
    expect(screen.getAllByText('Missing')).toHaveLength(4);

    const issues = section(/^Needs attention · \d+$/);
    const rows = within(issues).getAllByRole('button');
    expect(rows.length).toBeGreaterThan(12); // shown in full
    expect(rows[0].textContent).toContain('HTTP 404 – not indexable');
    expect(rows[0].textContent).toContain('Indexability ›');
    expect(rows[0].querySelector('.text-poor-text')!.textContent).toBe('×');

    fireEvent.click(within(issues).getByRole('button', { name: /No title tag/ }));
    expect(props.go).toHaveBeenCalledWith('content');
    fireEvent.click(within(issues).getByRole('button', { name: /og:title missing/ }));
    expect(props.go).toHaveBeenCalledWith('social');
    const headers = within(issues).getByRole('button', { name: /Strict-Transport-Security/ });
    expect(headers.textContent).toContain('HTTP headers ›');
    expect(headers.querySelector('.text-warn-text')!.textContent).toBe('!');
  });

  it('names a canonical that only drops tracking parameters and keeps the page indexable', () => {
    const tagged = `${PAGE_URL}?utm_source=x&utm_medium=popup`;
    renderPage(Overview, {
      ctx: tabContext({ url: tagged }),
      snap: pageSnap({ url: tagged, canonicals: [PAGE_URL] }),
    });
    expect(kv(section('Page'), 'Canonical')).toBe('This page without its tracking parameters');
    expect(screen.getByText('Indexable')).toBeTruthy();
    expect(screen.queryByText('Not indexable')).toBeNull();
  });

  it('flags long values, several H1s, a canonical elsewhere and skips headers without a response', () => {
    renderPage(Overview, {
      ctx: tabContext({ nav: null }),
      snap: pageSnap({
        title: 'A title that is far too long for a search result to show in full',
        canonicals: ['https://www.example.com/cwv'],
        headings: [
          { level: 1, text: 'First' },
          { level: 1, text: 'Second' },
        ],
        timing: { ttfb: 0, fcp: 0, domContentLoaded: 0, load: 0, transferSize: 0 },
      }),
    });
    expect(screen.queryByText(/OK$/)).toBeNull();
    expect(screen.queryByText(/^Loaded in/)).toBeNull();
    expect(screen.getByText('64 characters, aim for 30–60').className).toContain('text-warn-text');
    expect(screen.getByText('2 H1 headings')).toBeTruthy();
    expect(screen.getAllByText('https://www.example.com/cwv').length).toBeGreaterThan(0);
    expect(kv(section('Crawl'), 'Status')).toBe('–');
    expect(kv(section('Crawl'), 'Redirects')).toBe('Unknown – not recorded');
  });

  it("shows the page's own status when the response was not recorded", () => {
    renderPage(Overview, { ctx: tabContext({ nav: null }), snap: pageSnap({ status: 200 }) });
    expect(kv(section('Crawl'), 'Status')).toBe('200 OK · From the page, reload to record');
    expect(screen.getAllByText('200 OK').length).toBeGreaterThan(0); // the status pill
  });

  it('notes a missing lang attribute', () => {
    renderPage(Overview, { snap: pageSnap({ lang: '' }) });
    expect(screen.getByText('No lang attribute')).toBeTruthy();
  });
});
