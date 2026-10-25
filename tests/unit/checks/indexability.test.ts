import { describe, expect, it } from 'vitest';
import {
  header,
  indexability,
  linkHeaderCanonicals,
  robotsDirectives,
} from '../../../src/lib/checks/indexability';
import { parseRobots } from '../../../src/lib/checks/robots';
import { ids, meta, nav, snap } from '../fixtures';

const PAGE_URL = 'https://www.example.com/page';
const self = snap({ url: PAGE_URL, canonicals: [PAGE_URL] });
const xrt = (...values: string[]) =>
  nav({ headers: values.map((v) => ['X-Robots-Tag', v] as [string, string]) });
const directives = (s: ReturnType<typeof snap>, n: ReturnType<typeof nav> | null) =>
  [...robotsDirectives(s, n)].sort();

describe('header', () => {
  it('returns all values of a header case-insensitively', () => {
    const n = nav({
      headers: [
        ['Link', 'a'],
        ['content-type', 'text/html'],
        ['LINK', 'b'],
      ],
    });
    expect(header(n, 'link')).toEqual(['a', 'b']);
    expect(header(null, 'link')).toEqual([]);
  });
});

describe('robotsDirectives', () => {
  it('merges meta robots and meta googlebot', () => {
    const s = snap({
      meta: [...meta({ robots: 'NoIndex, Follow' }), { key: 'googlebot', content: 'nosnippet' }],
    });
    expect(directives(s, null)).toEqual(['follow', 'noindex', 'nosnippet']);
  });

  it('expands none into noindex and nofollow', () => {
    expect(directives(snap({ meta: meta({ robots: 'none' }) }), null)).toEqual([
      'nofollow',
      'noindex',
      'none',
    ]);
  });

  it.each([
    [['noindex'], ['noindex']],
    [['googlebot: noindex, nofollow'], ['nofollow', 'noindex']],
    [['all: noarchive'], ['noarchive']],
    [
      ['noindex', 'nofollow'],
      ['nofollow', 'noindex'],
    ],
    [['max-snippet: 20, noarchive'], ['max-snippet: 20', 'noarchive']],
    [
      ['unavailable_after: 25 Jun 2030 15:00:00 PST'],
      ['unavailable_after: 25 jun 2030 15:00:00 pst'],
    ],
  ])('X-Robots-Tag %j → %j', (values, expected) => {
    expect(directives(snap(), xrt(...values))).toEqual(expected);
  });

  // Regression: a value scoped to another crawler ("bingbot: noindex") is applied as if it were for
  // Google, because unknown agent names fall into the "not a directive" branch and return m[2].
  it('ignores X-Robots-Tag values scoped to other crawlers', () => {
    expect(directives(snap(), xrt('bingbot: noindex'))).toEqual([]);
  });
});

describe('linkHeaderCanonicals', () => {
  it('reads rel=canonical from Link headers, quoted or not, resolving relative URLs', () => {
    const n = nav({
      headers: [
        [
          'Link',
          '<https://cdn.example.com/a.css>; rel=preload; as=style, </page?a,b>; rel="canonical"',
        ],
        ['link', '<https://www.example.com/other>; REL=canonical'],
        ['Link', '<https://www.example.com/alt>; rel="alternate"; hreflang="de"'],
      ],
    });
    expect(linkHeaderCanonicals(n, PAGE_URL)).toEqual([
      'https://www.example.com/page?a,b',
      'https://www.example.com/other',
    ]);
    expect(linkHeaderCanonicals(null, PAGE_URL)).toEqual([]);
  });
});

describe('indexability', () => {
  it('is indexable with a self canonical and a 200', () => {
    expect(indexability(self, nav(), null)).toEqual({
      indexable: true,
      findings: [{ id: 'index.ok', level: 'good' }],
      canonical: PAGE_URL,
      canonicalSelf: true,
      canonicalClean: false,
    });
  });

  it('indexes the clean URL of a page visited with tracking parameters', () => {
    const tagged = snap({
      url: 'https://www.example.com/?utm_source=extension&utm_medium=popup&gclid=x',
      canonicals: ['https://www.example.com/'],
    });
    const r = indexability(tagged, nav(), null);
    expect(r).toMatchObject({ indexable: true, canonicalSelf: false, canonicalClean: true });
    expect(r.findings).toEqual([
      { id: 'index.ok', level: 'good' },
      { id: 'canonical.clean', level: 'info', params: { url: 'https://www.example.com/' } },
    ]);
  });

  it('keeps other parameters: a canonical that drops them points to another URL', () => {
    const r = indexability(
      snap({ url: `${PAGE_URL}?page=2&utm_source=x`, canonicals: [PAGE_URL] }),
      nav(),
      null,
    );
    expect(r).toMatchObject({ indexable: false, canonicalClean: false });
    expect(ids(r.findings)).toContain('canonical.other');
    expect(
      indexability(
        snap({ url: `${PAGE_URL}?page=2&utm_source=x`, canonicals: [`${PAGE_URL}?page=2`] }),
        nav(),
        null,
      ).canonicalClean,
    ).toBe(true);
  });

  it('ignores the fragment when comparing canonical and URL', () => {
    expect(
      indexability({ ...self, canonicals: [`${PAGE_URL}#top`] }, nav(), null).canonicalSelf,
    ).toBe(true);
  });

  it('flags error and redirect statuses', () => {
    const r404 = indexability(self, nav({ status: 404 }), null);
    expect(r404.indexable).toBe(false);
    expect(r404.findings).toContainEqual({
      id: 'index.status',
      level: 'bad',
      params: { status: 404 },
    });
    const r301 = indexability(self, nav({ status: 301 }), null);
    expect(r301.indexable).toBe(true);
    expect(ids(r301.findings)).toEqual(['index.ok', 'index.redirected']);
  });

  it("falls back to the page's own status when no response was recorded", () => {
    const r = indexability({ ...self, status: 404 }, null, null);
    expect(r.indexable).toBe(false);
    expect(r.findings).toContainEqual({
      id: 'index.status',
      level: 'bad',
      params: { status: 404 },
    });
    // A recorded response wins over the page's timing.
    expect(indexability({ ...self, status: 404 }, nav(), null).indexable).toBe(true);
  });

  it('tells meta noindex from X-Robots-Tag noindex', () => {
    const fromMeta = indexability(
      { ...self, meta: meta({ robots: 'noindex, nofollow' }) },
      nav(),
      null,
    );
    expect(fromMeta.indexable).toBe(false);
    expect(ids(fromMeta.findings)).toEqual(['index.noindexMeta', 'index.nofollow']);
    expect(ids(indexability(self, xrt('none'), null).findings)).toEqual([
      'index.noindexHeader',
      'index.nofollow',
    ]);
  });

  it('checks robots.txt for Googlebot', () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /pa',
    );
    const r = indexability(self, nav(), robots);
    expect(r.indexable).toBe(false);
    expect(r.findings).toContainEqual({
      id: 'index.robotsBlocked',
      level: 'bad',
      params: { rule: '/pa' },
    });
    expect(
      indexability(self, nav(), parseRobots('User-agent: Googlebot\nDisallow: /other')).indexable,
    ).toBe(true);
  });

  it('treats a canonical to another URL as not indexable', () => {
    const r = indexability({ ...self, canonicals: ['https://www.example.com/page/'] }, nav(), null);
    expect(r).toMatchObject({
      indexable: false,
      canonicalSelf: false,
      canonical: 'https://www.example.com/page/',
    });
    expect(r.findings).toEqual([
      { id: 'canonical.other', level: 'warn', params: { url: 'https://www.example.com/page/' } },
    ]);
  });

  it('combines HTML and Link header canonicals', () => {
    const same = nav({ headers: [['Link', `<${PAGE_URL}>; rel="canonical"`]] });
    expect(ids(indexability(self, same, null).findings)).toEqual(['index.ok']);
    const other = nav({ headers: [['Link', '<https://www.example.com/b>; rel="canonical"']] });
    expect(indexability(self, other, null).findings).toContainEqual({
      id: 'canonical.multiple',
      level: 'bad',
      params: { n: 2 },
    });
    const headerOnly = indexability({ ...self, canonicals: [] }, same, null);
    expect(headerOnly.canonicalSelf).toBe(true);
  });

  it('warns about a missing canonical without blocking indexing', () => {
    const r = indexability({ ...self, canonicals: [] }, null, null);
    expect(r).toMatchObject({ indexable: true, canonical: null, canonicalSelf: null });
    expect(ids(r.findings)).toEqual(['index.ok', 'canonical.missing']);
  });
});
