import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentFindings } from '../../../src/lib/checks/content';
import { headerFindings } from '../../../src/lib/checks/headers';
import { hreflangFindings } from '../../../src/lib/checks/hreflang';
import { analyseImages } from '../../../src/lib/checks/images';
import { indexability } from '../../../src/lib/checks/indexability';
import { classifyLinks } from '../../../src/lib/checks/links';
import { redirectFindings } from '../../../src/lib/checks/redirects';
import { auditResources } from '../../../src/lib/checks/resources';
import { analyseSchema } from '../../../src/lib/checks/schema';
import { socialFindings } from '../../../src/lib/checks/social';
import type { TabContext } from '../../../src/lib/messages';
import type { Finding, Level, TabVitals } from '../../../src/lib/types';
import { pageCounts, sum } from '../../../src/popup/badges';
import { nav, snap } from '../fixtures';

// The checks themselves have their own tests; here they return fixed findings so the counting
// and grouping are what is under test.
vi.mock('../../../src/lib/checks/content', () => ({ contentFindings: vi.fn() }));
vi.mock('../../../src/lib/checks/headers', () => ({ headerFindings: vi.fn() }));
vi.mock('../../../src/lib/checks/hreflang', () => ({ hreflangFindings: vi.fn() }));
vi.mock('../../../src/lib/checks/images', () => ({ analyseImages: vi.fn() }));
vi.mock('../../../src/lib/checks/indexability', () => ({ indexability: vi.fn() }));
vi.mock('../../../src/lib/checks/links', () => ({ classifyLinks: vi.fn() }));
vi.mock('../../../src/lib/checks/redirects', () => ({ redirectFindings: vi.fn() }));
vi.mock('../../../src/lib/checks/resources', () => ({ auditResources: vi.fn() }));
vi.mock('../../../src/lib/checks/schema', () => ({ analyseSchema: vi.fn() }));
vi.mock('../../../src/lib/checks/social', () => ({ socialFindings: vi.fn() }));

const f = (...levels: Level[]): Finding[] =>
  levels.map((level, i) => ({ id: `finding-${i}`, level }));

const ctx = (overrides: Partial<TabContext> = {}): TabContext =>
  ({
    tabId: 1,
    url: 'https://www.example.com/page',
    title: 'Page',
    incognito: false,
    nav: nav(),
    vitals: null,
    js: 'allow',
    auth: { signedIn: false, workspaces: [], roles: {} },
    monitored: null,
    ...overrides,
  }) as TabContext;

const vitals = (
  ratings: Partial<Record<'LCP' | 'CLS' | 'INP', 'good' | 'needs-improvement' | 'poor'>>,
): TabVitals => ({
  url: 'https://www.example.com/page',
  metrics: Object.fromEntries(
    Object.entries(ratings).map(([name, rating]) => [name, { name, value: 1, rating }]),
  ),
  shifts: [],
});

beforeEach(() => {
  vi.mocked(contentFindings).mockReturnValue(f('good', 'warn', 'info', 'bad'));
  vi.mocked(analyseSchema).mockReturnValue({ items: [], errors: [], findings: f('good') });
  vi.mocked(socialFindings).mockReturnValue(f('warn', 'warn'));
  vi.mocked(analyseImages).mockReturnValue({ rows: [], findings: f('info'), savings: 0 });
  vi.mocked(indexability).mockReturnValue({ findings: f('warn') } as never);
  vi.mocked(hreflangFindings).mockReturnValue(f('bad'));
  vi.mocked(classifyLinks).mockReturnValue({ findings: [] } as never);
  vi.mocked(auditResources).mockReturnValue({ findings: f('warn', 'good') } as never);
  vi.mocked(headerFindings).mockReturnValue(f('warn'));
  vi.mocked(redirectFindings).mockReturnValue(f('warn', 'info'));
});

describe('pageCounts', () => {
  it('counts warn and bad findings per page and flags pages with a bad one', () => {
    const counts = pageCounts(snap(), ctx());
    expect(counts).toEqual({
      content: { n: 2, bad: true },
      schema: { n: 0, bad: false },
      social: { n: 2, bad: false },
      images: { n: 0, bad: false },
      indexability: { n: 2, bad: true }, // indexability and hreflang together
      links: { n: 0, bad: false },
      performance: { n: 1, bad: false },
      headers: { n: 2, bad: false }, // headers and redirects together
    });
  });

  it('passes the snapshot and navigation to the checks', () => {
    const s = snap({ url: 'https://www.example.com/a', jsonLd: ['{}'] });
    const c = ctx();
    pageCounts(s, c);
    expect(analyseSchema).toHaveBeenCalledWith(['{}']);
    expect(indexability).toHaveBeenCalledWith(s, c.nav, null);
    expect(classifyLinks).toHaveBeenCalledWith(s.links, 'https://www.example.com/a');
    expect(auditResources).toHaveBeenCalledWith(s.resources, 'https://www.example.com/a');
  });

  it.each([
    { name: 'all good', ratings: { LCP: 'good', CLS: 'good' }, perf: { n: 1, bad: false } },
    {
      name: 'one needs improvement',
      ratings: { LCP: 'needs-improvement', INP: 'good' },
      perf: { n: 2, bad: false },
    },
    {
      name: 'one poor',
      ratings: { LCP: 'poor', CLS: 'needs-improvement' },
      perf: { n: 3, bad: true },
    },
  ] as const)(
    'adds Core Web Vitals that are not good to performance: $name',
    ({ ratings, perf }) => {
      expect(pageCounts(snap(), ctx({ vitals: vitals(ratings) })).performance).toEqual(perf);
    },
  );

  it('has no header count without a navigation record', () => {
    expect(pageCounts(snap(), ctx({ nav: null })).headers).toBeUndefined();
    expect(headerFindings).not.toHaveBeenCalled();
  });

  it('has no header count for a navigation still in flight (no status yet)', () => {
    expect(pageCounts(snap(), ctx({ nav: nav({ status: 0 }) })).headers).toBeUndefined();
    expect(headerFindings).not.toHaveBeenCalled();
  });
});

describe('sum', () => {
  it.each([
    { counts: [], total: { n: 0, bad: false } },
    { counts: [undefined, undefined], total: { n: 0, bad: false } },
    {
      counts: [{ n: 2, bad: false }, undefined, { n: 3, bad: false }],
      total: { n: 5, bad: false },
    },
    {
      counts: [
        { n: 1, bad: true },
        { n: 0, bad: false },
      ],
      total: { n: 1, bad: true },
    },
  ])('sums $counts', ({ counts, total }) => {
    expect(sum(counts)).toEqual(total);
  });
});
