import { cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Indexability from '../../../../src/popup/pages/Indexability';
import { meta } from '../../fixtures';
import {
  MONITORED,
  ORIGIN,
  PAGE_URL,
  SECURE_HEADERS,
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
});
afterEach(cleanup);

const pending = () => new Promise<never>(() => {});
const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const signal = (label: string) =>
  within(section('Signals')).getByText(label).nextElementSibling as HTMLElement;

describe('Indexability', () => {
  it('confirms an indexable page signal by signal', async () => {
    const { props } = renderPage(Indexability);
    expect(screen.getByText('Google can index this page')).toBeTruthy();
    expect(
      screen.getByText('Status, robots directives, canonical and robots.txt all allow indexing.'),
    ).toBeTruthy();
    expect(await screen.findByText('Allowed for Googlebot')).toBeTruthy();
    expect(signal('HTTP status').textContent).toBe('HTTP/1.1 200 OK');
    expect(signal('Meta robots').textContent).toBe('Not set');
    expect(signal('X-Robots-Tag').textContent).toBe('Not set');
    expect(signal('Directives').textContent).toBe('None (index, follow)');
    expect(signal('Canonical').textContent).toBe(`Self-referencing${PAGE_URL}`);
    expect(signal('robots.txt').textContent).toContain('No matching rule');
    expect(signal('Sitemap').textContent).toBe('Listed in the sitemap');

    fireEvent.click(screen.getByRole('button', { name: 'all crawlers ›' }));
    expect(props.go).toHaveBeenCalledWith('crawlers');
    expect(data.robots).toHaveBeenCalledWith(ORIGIN);
    expect(data.sitemaps).toHaveBeenCalledWith(PAGE_URL);
    expect(data.rawSnapshot).toHaveBeenCalledWith(PAGE_URL);
  });

  it('lists the sitemaps it read', async () => {
    data.sitemaps.mockResolvedValue({
      sources: [
        { url: `${ORIGIN}/sitemap.xml`, status: 200, kind: 'index', count: 2 },
        { url: `${ORIGIN}/sitemap-posts.xml`, status: 0, kind: 'unknown', count: 0 },
        {
          url: 'https://cdn.example.net/sitemap-2024.xml?v=2',
          status: 200,
          kind: 'urlset',
          count: 1200,
        },
        { url: 'http://localhost/sitemap.xml', status: 0, kind: 'skipped', count: 0 },
      ],
      listed: false,
    });
    renderPage(Indexability);
    const sitemaps = await screen.findByText('4 read').then(() => section('Sitemaps'));
    // Each host shows once; rows show the path, with the full URL as a tooltip.
    expect(within(sitemaps).getByText('www.example.com')).toBeTruthy();
    expect(within(sitemaps).getByText('cdn.example.net')).toBeTruthy();
    const posts = within(sitemaps).getByText('/sitemap-posts.xml');
    expect(posts.getAttribute('title')).toBe(`${ORIGIN}/sitemap-posts.xml`);
    expect(posts.parentElement!.textContent).toBe('/sitemap-posts.xmlError––');
    expect(within(sitemaps).getByText('Index')).toBeTruthy();
    expect(within(sitemaps).getByText('/sitemap-2024.xml?v=2').parentElement!.textContent).toBe(
      '/sitemap-2024.xml?v=2200Sitemap1,200',
    );
    expect(within(sitemaps).getByText('Skipped')).toBeTruthy();
    expect(signal('Sitemap').textContent).toBe('Not listed in any sitemap that was read');
  });

  it('shows loading states while robots.txt, sitemaps and raw HTML load', () => {
    data.robots.mockReturnValue(pending());
    data.sitemaps.mockReturnValue(pending());
    data.rawSnapshot.mockReturnValue(pending());
    renderPage(Indexability);
    expect(signal('robots.txt').textContent).toBe('Loading robots.txt…');
    expect(signal('Sitemap').textContent).toBe('Checking sitemaps…');
    expect(screen.getByText('Reading sitemaps…')).toBeTruthy();
    expect(screen.getByText('Fetching the raw HTML…')).toBeTruthy();
  });

  it('reports failed requests', async () => {
    data.robots.mockResolvedValue(null);
    data.sitemaps.mockRejectedValue(new Error('timeout'));
    data.rawSnapshot.mockRejectedValue(new Error('Failed to fetch'));
    renderPage(Indexability);
    expect(await screen.findByText('Sitemaps could not be read: timeout')).toBeTruthy();
    expect(signal('Sitemap').textContent).toBe('Could not be read (timeout)');
    expect(signal('robots.txt').textContent).toBe('robots.txt could not be fetched');
    expect(screen.getByText('The raw HTML could not be fetched: Failed to fetch')).toBeTruthy();
  });

  it('treats a missing robots.txt as allow-all and a missing sitemap as unknown', async () => {
    data.robots.mockResolvedValue(robotsResult('', 404));
    data.sitemaps.mockResolvedValue({ sources: [], listed: null });
    renderPage(Indexability);
    expect(
      await screen.findByText('No robots.txt (HTTP 404) – everything is allowed'),
    ).toBeTruthy();
    expect(signal('Sitemap').textContent).toBe('No sitemap found');
    expect(
      screen.getByText('No sitemap in robots.txt, /sitemap.xml or /sitemap_index.xml.'),
    ).toBeTruthy();
  });

  it('explains why Google will not index a blocked, noindexed page', async () => {
    data.robots.mockResolvedValue(robotsResult('User-agent: *\nDisallow: /blog/\n'));
    const ctx = tabContext({
      nav: navRecord({
        statusLine: '',
        redirects: [
          { url: 'http://example.com/blog/core-web-vitals', status: 301, location: PAGE_URL },
        ],
        headers: [
          ...SECURE_HEADERS,
          ['x-robots-tag', 'noindex'],
          ['link', `<${ORIGIN}/cwv>; rel="canonical"`],
        ],
      }),
    });
    renderPage(Indexability, {
      ctx,
      snap: pageSnap({ meta: meta({ robots: 'nofollow' }), canonicals: [`${ORIGIN}/cwv`] }),
    });
    expect(await screen.findByText('Blocked for Googlebot')).toBeTruthy();
    expect(screen.getByText('Google will not index this page')).toBeTruthy();
    expect(screen.getByText(/Blocked for Googlebot by robots\.txt \(\/blog\/\)/)).toBeTruthy();
    expect(signal('robots.txt').textContent).toContain('Line 2 · Disallow: /blog/');
    expect(signal('HTTP status').textContent).toBe('200 after 1 redirect');
    expect(signal('Meta robots').textContent).toBe('nofollow');
    expect(signal('X-Robots-Tag').textContent).toBe('noindex');
    expect(signal('Directives').textContent).toBe('nofollow, noindex');
    expect(signal('Canonical').textContent).toContain('Points to another URL');
    expect(signal('Canonical').textContent).toContain(`Link header: ${ORIGIN}/cwv`);
  });

  it('says Google indexes the clean URL of a page opened with tracking parameters', async () => {
    renderPage(Indexability, {
      snap: pageSnap({
        url: `${ORIGIN}/?utm_source=extension&utm_medium=popup`,
        canonicals: [`${ORIGIN}/`],
      }),
    });
    expect(await screen.findByText('Google indexes the clean URL of this page')).toBeTruthy();
    expect(
      screen.getByText(
        `This address only adds tracking parameters; the canonical ${ORIGIN}/ is the version Google indexes`,
      ),
    ).toBeTruthy();
    expect(signal('Canonical').textContent).toContain('This page without its tracking parameters');
  });

  it('marks nofollow alone as a warning and counts several redirects', async () => {
    renderPage(Indexability, {
      ctx: tabContext({
        nav: navRecord({
          redirects: [
            { url: 'http://a', status: 301, location: 'b' },
            { url: 'http://b', status: 302, location: 'c' },
          ],
        }),
      }),
      snap: pageSnap({ meta: meta({ googlebot: 'nofollow' }), canonicals: [] }),
    });
    expect(signal('HTTP status').textContent).toBe('HTTP/1.1 200 OK after 2 redirects');
    expect(signal('Directives').textContent).toBe('nofollow');
    expect(signal('Canonical').textContent).toBe('Missing');
    await screen.findByText('Allowed for Googlebot');
  });

  it('works without a recorded response', async () => {
    renderPage(Indexability, { ctx: tabContext({ nav: null }) });
    expect(signal('HTTP status').textContent).toBe(
      'Unknown – the page loaded before the extension started',
    );
    expect(signal('X-Robots-Tag').textContent).toBe('Unknown');
    await screen.findByText('Allowed for Googlebot');
  });

  it("uses the page's own status when no response was recorded", async () => {
    renderPage(Indexability, { ctx: tabContext({ nav: null }), snap: pageSnap({ status: 404 }) });
    expect(signal('HTTP status').textContent).toBe(
      '404From the page – redirects and headers were not recorded',
    );
    expect(screen.getByText('Google will not index this page')).toBeTruthy();
    await screen.findByText('Allowed for Googlebot');
  });

  it('treats a robots.txt server error as blocking everything', async () => {
    data.robots.mockResolvedValue(robotsResult('', 503));
    renderPage(Indexability);
    expect(
      await screen.findByText(
        'robots.txt answers HTTP 503 – Google crawls nothing until it can read the file',
      ),
    ).toBeTruthy();
  });
});

describe('hreflang', () => {
  it('says when there are no annotations', () => {
    renderPage(Indexability);
    expect(screen.getByRole('heading', { name: 'hreflang · 0' })).toBeTruthy();
    expect(screen.getByText('No hreflang annotations on this page.')).toBeTruthy();
  });

  it('lists annotations and their problems', () => {
    renderPage(Indexability, {
      snap: pageSnap({
        hreflang: [
          { lang: 'en-UK', href: `${ORIGIN}/uk` },
          { lang: 'de', href: `${ORIGIN}/de` },
        ],
      }),
    });
    const h = section('hreflang · 2');
    expect(within(h).getByText('en-UK')).toBeTruthy();
    expect(within(h).getByText(`${ORIGIN}/de`)).toBeTruthy();
    expect(within(h).getByText('Invalid hreflang code: en-UK')).toBeTruthy();
    expect(within(h).getByText('No hreflang entry for this page itself')).toBeTruthy();
  });
});

describe('raw HTML vs rendered', () => {
  const raw = section.bind(null, 'Raw HTML vs rendered page');

  it('compares field by field and confirms agreement', async () => {
    renderPage(Indexability);
    expect(await screen.findByText('Raw HTML and the rendered page agree.')).toBeTruthy();
    expect(within(raw()).getByText('JSON-LD blocks')).toBeTruthy();
    const title = within(raw()).getByText('Core Web Vitals explained: a practical guide');
    expect(title.getAttribute('title')).toBe('Core Web Vitals explained: a practical guide');
    expect(within(raw()).getAllByText('Same')).toHaveLength(9);
    expect(within(raw()).getByText('Not set')).toBeTruthy(); // robots meta empty on both sides
    expect(within(raw()).getByText('1,250')).toBeTruthy();
  });

  it('flags what JavaScript changes', async () => {
    data.rawSnapshot.mockResolvedValue({
      status: 200,
      snapshot: pageSnap({ title: 'Loading…', headings: [] }),
    });
    renderPage(Indexability);
    expect(await screen.findByText('JavaScript changes the title')).toBeTruthy();
    expect(screen.getByText('The H1 only appears after JavaScript runs')).toBeTruthy();
    expect(within(raw()).getByText('Loading…').className).toContain('text-warn-text');
    expect(within(raw()).getByText('H1').closest('.grid')!.textContent).toMatch(/^H1Not set.+/);
  });

  it('shows how much JavaScript adds to counts', async () => {
    data.rawSnapshot.mockResolvedValue({
      status: 200,
      snapshot: pageSnap({ wordCount: 250, links: [] }),
    });
    renderPage(Indexability);
    const words = await screen.findByText('250');
    expect(words.closest('.grid')!.textContent).toBe('Words2501,250 (+1,000 by JS)');
  });

  it('explains a non-HTML raw response', async () => {
    data.rawSnapshot.mockResolvedValue({ status: 200, snapshot: null });
    renderPage(Indexability);
    expect(
      await screen.findByText(
        'The raw response is not HTML (HTTP 200), so there is nothing to compare.',
      ),
    ).toBeTruthy();
  });
});

describe('a monitored site', () => {
  it("adds Google's own index verdict after the signals", async () => {
    mockSend({ 'app:overview': () => ({ ok: true, data: appOverview() }) });
    renderPage(Indexability, { ctx: tabContext({ auth: SIGNED_IN, monitored: MONITORED }) });
    expect(screen.getByRole('status', { name: 'Loading Google index' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading the Google index status' })).toBeTruthy();
    expect(await screen.findByText('Submitted and indexed')).toBeTruthy();
    const google = screen
      .getByRole('heading', { level: 2, name: 'Google index' })
      .closest('section') as HTMLElement;
    expect(within(google).getByText('Submitted and indexed')).toBeTruthy();
    // The verdict banner says whether Google really has the page.
    expect(screen.getByText('In Google’s index')).toBeTruthy();
    expect(within(google).getByText('https://www.example.com/blog/cwv')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Google index')).toBe(headings.indexOf('Signals') + 1);
  });
});
