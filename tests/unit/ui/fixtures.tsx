import { render } from '@testing-library/preact';
import type { FunctionComponent } from 'preact';
import { vi } from 'vitest';
import type { Domain, UrlOverview } from '../../../src/lib/app';
import { parseRobots } from '../../../src/lib/checks/robots';
import * as messages from '../../../src/lib/messages';
import type { AuthState, RequestType, Requests, TabContext } from '../../../src/lib/messages';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/lib/settings';
import { TERMS_VERSION } from '../../../src/lib/config';
import type { NavRecord, PageSnapshot, TabVitals } from '../../../src/lib/types';
import * as data from '../../../src/popup/data';
import type { PageKey } from '../../../src/popup/nav';
import type { PageProps } from '../../../src/popup/types';
import { image, link, meta, nav, resource, snap } from '../fixtures';

// A realistic, issue-free blog post as the analyser and the worker would report it. Tests add
// the problem they care about with an override, so every assertion names its own cause.

export const PAGE_URL = 'https://www.example.com/blog/core-web-vitals';
export const ORIGIN = 'https://www.example.com';

export const ARTICLE_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Core Web Vitals explained',
  image: 'https://www.example.com/img/hero.webp',
  datePublished: '2026-09-01',
  dateModified: '2026-10-01',
  author: { '@type': 'Person', name: 'Jane Doe', url: 'https://www.example.com/jane' },
});

export function pageSnap(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return snap({
    url: PAGE_URL,
    title: 'Core Web Vitals explained: a practical guide',
    lang: 'en',
    meta: meta({
      description:
        'What LCP, INP and CLS measure, how Google rates them and the fixes that move each metric the most.',
      viewport: 'width=device-width, initial-scale=1',
      author: 'Jane Doe',
      'og:title': 'Core Web Vitals explained',
      'og:description': 'What LCP, INP and CLS measure and how to fix them.',
      'og:image': 'https://www.example.com/img/og.png',
      'og:url': PAGE_URL,
      'og:site_name': 'Example Blog',
      'twitter:card': 'summary_large_image',
    }),
    canonicals: [PAGE_URL],
    headings: [
      { level: 1, text: 'Core Web Vitals explained' },
      { level: 2, text: 'Largest Contentful Paint' },
      { level: 3, text: 'Measuring LCP' },
    ],
    wordCount: 1250,
    links: [
      link('https://www.example.com/', { text: 'Home', inNav: true }),
      link('https://www.example.com/blog/inp', { text: 'Interaction to Next Paint' }),
      link('https://web.dev/articles/vitals', { text: 'web.dev on Web Vitals' }),
    ],
    images: [
      image({
        src: 'https://www.example.com/img/chart.webp',
        alt: 'LCP chart',
        naturalWidth: 800,
        naturalHeight: 600,
      }),
    ],
    jsonLd: [ARTICLE_LD],
    semantic: { main: true, article: true, nav: true, header: true, footer: true },
    scripts: ['https://www.example.com/assets/app.js'],
    resources: [
      resource('https://www.example.com/assets/app.js', {
        transferSize: 40_000,
        encodedSize: 40_000,
        decodedSize: 120_000,
        duration: 120,
      }),
    ],
    timing: { ttfb: 180, fcp: 900, domContentLoaded: 1200, load: 2100, transferSize: 18_000 },
    htmlBytes: 64_000,
    ...overrides,
  });
}

export const SECURE_HEADERS: [string, string][] = [
  ['content-type', 'text/html; charset=utf-8'],
  ['content-encoding', 'br'],
  ['cache-control', 'max-age=300'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['content-security-policy', "default-src 'self'"],
  ['x-frame-options', 'SAMEORIGIN'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['permissions-policy', 'camera=()'],
];

export function navRecord(overrides: Partial<NavRecord> = {}): NavRecord {
  return nav({
    tabId: 7,
    url: PAGE_URL,
    headers: SECURE_HEADERS,
    startedAt: Date.now() - 5000,
    ...overrides,
  });
}

export function tabVitals(overrides: Partial<TabVitals> = {}): TabVitals {
  return {
    url: PAGE_URL,
    metrics: {
      LCP: { name: 'LCP', value: 1800, rating: 'good', target: 'img.hero' },
      CLS: { name: 'CLS', value: 0.02, rating: 'good' },
    },
    shifts: [],
    ...overrides,
  };
}

export const SIGNED_OUT: AuthState = { signedIn: false, workspaces: [], roles: {} };
export const SIGNED_IN: AuthState = {
  signedIn: true,
  workspaces: [{ id: 'ws1', name: 'Acme', plan: 'pro' }],
  roles: { ws1: 'owner' },
};
export const MONITORED: Domain = {
  id: 'dom1',
  workspace_id: 'ws1',
  domain: 'example.com',
  active_modules: ['rum', 'gsc'],
};

export function tabContext(overrides: Partial<TabContext> = {}): TabContext {
  return {
    tabId: 7,
    url: PAGE_URL,
    title: 'Core Web Vitals explained: a practical guide',
    incognito: false,
    nav: navRecord(),
    vitals: tabVitals(),
    js: 'allow',
    auth: SIGNED_OUT,
    monitored: null,
    ...overrides,
  };
}

// Terms accepted unless a test says otherwise, so the popup shows its reports.
export const settingsFixture = (overrides: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  termsAccepted: TERMS_VERSION,
  ...overrides,
});

export const ROBOTS_TXT =
  'User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://www.example.com/sitemap.xml\n';

export const robotsResult = (text = ROBOTS_TXT, status = 200) => ({
  status,
  text,
  parsed: parseRobots(text),
});

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

type KnownSections = Pick<
  UrlOverview['sections'],
  'crawl' | 'search_console' | 'indexing' | 'web_analytics' | 'crux'
>;

/** A /url-overview answer with every section ok, shaped like src/lib/app.ts. */
export function urlOverview(
  sections: Partial<KnownSections> = {},
  overrides: Partial<UrlOverview> = {},
): UrlOverview {
  const base = { status: 'ok' as const, as_of: isoAgo(2 * 3600_000), scope: 'url' as const };
  const cruxWeeks = (metric: string, values: number[]) =>
    values.map((p75, i) => ({
      form_factor: 'PHONE',
      metric,
      collection_date: `2026-0${(i % 9) + 1}-15`,
      p75,
      good_share: 0.8,
    }));
  return {
    domain_id: MONITORED.id,
    url: PAGE_URL,
    generated_at: isoAgo(10 * 60_000),
    cached: false,
    missing_scopes: [],
    sections: {
      crawl: { ...base, watch: null },
      search_console: {
        ...base,
        deep_link: 'https://app.vitalsentinel.com/dashboard/domains/dom1/search?url=x',
        window_days: 90,
        clicks: 12_400,
        impressions: 530_000,
        ctr: 0.0234,
        average_position: 7.42,
        top_queries: [
          {
            query: 'core web vitals &amp; seo',
            clicks: 820,
            impressions: 21_000,
            average_position: 3.1,
          },
          { query: 'what is inp', clicks: 410, impressions: 9_800, average_position: null },
        ],
      },
      indexing: {
        ...base,
        verdict: 'PASS',
        coverage_state: 'Submitted and indexed',
        google_canonical: 'https://www.example.com/blog/cwv',
        user_canonical: PAGE_URL,
        canonical_differs: true,
        last_crawl_time: '2026-10-20T08:00:00Z',
        crawled_as: 'MOBILE',
      },
      web_analytics: {
        ...base,
        scope: 'domain',
        window_days: 90,
        path: '/blog/core-web-vitals',
        pageviews: 8_210,
        entrances: 5_120,
        bounce_rate: 0.41,
      },
      crux: {
        ...base,
        records: [
          ...cruxWeeks('LCP', [2600, 2500, 2400]),
          ...cruxWeeks('CLS', [0.05]),
          {
            form_factor: 'DESKTOP',
            metric: 'LCP',
            collection_date: '2026-01-15',
            p75: 1200,
            good_share: 0.9,
          },
        ],
      },
      ...sections,
    },
    ...overrides,
  };
}

export const AXE_RESULT: data.AxeResult = {
  violations: [
    {
      id: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
      nodes: Array.from({ length: 5 }, (_, i) => ({
        target: `img:nth-child(${i + 1})`,
        summary: 'Fix any of the following',
      })),
      count: 7,
    },
    {
      id: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
      nodes: [{ target: '.footer a', summary: 'Contrast 3.1:1' }],
      count: 1,
    },
    {
      id: 'region',
      impact: 'moderate',
      help: 'All page content should be contained by landmarks',
      helpUrl: 'https://x/region',
      nodes: [],
      count: 2,
    },
    {
      id: 'odd',
      impact: 'unknown-impact',
      help: 'Something minor',
      helpUrl: 'https://x/odd',
      nodes: [],
      count: 1,
    },
  ],
  passes: 31,
  passIds: Array.from({ length: 14 }, (_, i) => `rule-${i + 1}`),
};

/** Default, deterministic behaviour for every data-layer stub; override per test. */
export function setupData() {
  const d = vi.mocked(data);
  d.currentTabId.mockResolvedValue(7);
  d.context.mockResolvedValue(tabContext());
  d.settings.mockResolvedValue(settingsFixture());
  d.saveSettings.mockImplementation(async (patch) => settingsFixture(patch));
  d.snapshot.mockResolvedValue(pageSnap());
  d.fetchText.mockResolvedValue({ status: 404, text: '', contentType: 'text/html', url: '' });
  d.robots.mockResolvedValue(robotsResult());
  d.sitemaps.mockResolvedValue({
    sources: [{ url: `${ORIGIN}/sitemap.xml`, status: 200, kind: 'urlset', count: 120 }],
    listed: true,
  });
  d.sitemapsIfChecked.mockResolvedValue({
    sources: [{ url: `${ORIGIN}/sitemap.xml`, status: 200, kind: 'urlset', count: 120 }],
    listed: true,
  });
  d.rawSnapshot.mockResolvedValue({ status: 200, snapshot: pageSnap() });
  d.probe.mockResolvedValue({ globals: [], consentMode: null });
  d.cookies.mockResolvedValue([]);
  d.runAxe.mockResolvedValue(AXE_RESULT);
  d.overlay.mockResolvedValue({ lcp: true, shifts: 2 });
  d.overlayShown.mockResolvedValue(false);
  d.reloadTab.mockResolvedValue(undefined);
  d.linkStatuses.mockImplementation(async (urls, onResult) =>
    urls.forEach((u) => onResult(u, 200)),
  );
  d.changesSinceLastVisit.mockResolvedValue(null);
  return d;
}

type Handlers = {
  [K in RequestType]?: (
    req: Requests[K]['req'],
  ) => Requests[K]['res'] | Promise<Requests[K]['res']>;
};

/** Routes send(type, req) to a handler per message type; unhandled types answer null. */
export function mockSend(handlers: Handlers = {}) {
  const send = vi.mocked(messages.send);
  send.mockImplementation((async (type: RequestType, req: never) => {
    const h = handlers[type] as ((r: never) => unknown) | undefined;
    return h ? h(req) : null;
  }) as typeof messages.send);
  return send;
}

/** Renders a report page with realistic props; returns the props for assertions. */
export function renderPage(Page: FunctionComponent<PageProps>, props: Partial<PageProps> = {}) {
  const all: PageProps = {
    page: 'overview' as PageKey,
    ctx: tabContext(),
    snap: pageSnap(),
    settings: settingsFixture(),
    go: vi.fn(),
    reload: vi.fn(),
    ...props,
  };
  return { ...render(<Page {...all} />), props: all };
}

/**
 * happy-dom's OffscreenCanvas has no 2D context; Content.tsx measures SERP widths with one at
 * module load. 8 px per character keeps the numbers easy to check.
 */
export function stubCanvas() {
  const ctx = { font: '', measureText: (t: string) => ({ width: t.length * 8 }) };
  vi.spyOn(OffscreenCanvas.prototype, 'getContext').mockReturnValue(
    ctx as unknown as OffscreenCanvasRenderingContext2D,
  );
}
