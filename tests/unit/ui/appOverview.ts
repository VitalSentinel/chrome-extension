import type {
  CrawlSection,
  CruxSection,
  IndexingSection,
  SearchConsoleSection,
  UrlOverview,
  WebAnalyticsSection,
} from '../../../src/lib/app';

// The url-overview answer the report pages read: the four 90-day sections and the watch state.

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

export interface AppSections {
  crawl?: CrawlSection;
  search_console?: SearchConsoleSection;
  indexing?: IndexingSection;
  web_analytics?: WebAnalyticsSection;
  crux?: CruxSection;
}

export function appOverview(sections: Partial<AppSections> = {}): UrlOverview {
  const base = { status: 'ok' as const, as_of: isoAgo(2 * 3600_000), scope: 'url' as const };
  const weeks = (metric: string, values: number[]) =>
    values.map((p75, i) => ({
      form_factor: 'PHONE',
      metric,
      collection_date: `2026-0${(i % 9) + 1}-15`,
      p75,
      good_share: 0.8,
    }));
  return {
    domain_id: 'dom1',
    url: 'https://example.com/blog/core-web-vitals',
    generated_at: isoAgo(10 * 60_000),
    cached: false,
    missing_scopes: [],
    sections: {
      crawl: { ...base, watch: null },
      search_console: {
        ...base,
        deep_link: '/dashboard/domains/dom1/search?url=x',
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
        user_canonical: 'https://example.com/blog/core-web-vitals',
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
          ...weeks('LCP', [2600, 2500, 2400]),
          ...weeks('CLS', [0.05]),
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
  };
}
