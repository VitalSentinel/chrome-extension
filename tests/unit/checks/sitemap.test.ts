import { describe, expect, it } from 'vitest';
import { defaultSitemaps, listsUrl, parseSitemap, sameUrl } from '../../../src/lib/checks/sitemap';

describe('parseSitemap', () => {
  it('reads a urlset, decoding entities and CDATA but not image:loc', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>https://example.com/?a=1&amp;b=2</loc><lastmod>2026-10-01</lastmod></url>
  <url>
    <loc><![CDATA[ https://example.com/caf%C3%A9 ]]></loc>
    <image:image><image:loc>https://example.com/i.jpg</image:loc></image:image>
  </url>
  <url><LOC>https://example.com/&quot;q&quot;&apos;&lt;&gt;</LOC></url>
</urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      locs: [
        'https://example.com/?a=1&b=2',
        'https://example.com/caf%C3%A9',
        'https://example.com/"q"\'<>',
      ],
    });
  });

  it('recognises a sitemap index', () => {
    const xml =
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemap(xml)).toEqual({ kind: 'index', locs: ['https://example.com/s1.xml'] });
  });

  it('returns unknown for other documents', () => {
    expect(parseSitemap('<!doctype html><html><body>Not found</body></html>')).toEqual({
      kind: 'unknown',
      locs: [],
    });
    expect(parseSitemap('<urlsetx></urlsetx>').kind).toBe('unknown');
    // An RSS feed's <image><url> is not a sitemap entry.
    expect(
      parseSitemap(
        '<rss><channel><image><url>https://a.example/l.png</url></image></channel></rss>',
      ).kind,
    ).toBe('unknown');
  });
});

describe('parseSitemap on real-world files', () => {
  it('reads <url> entries under a root named <sitemap> as a urlset (dennikn.sk)', () => {
    const xml =
      '<sitemap xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://dennikn.sk/blog/1/</loc></url><url><loc>https://dennikn.sk/blog/2/</loc></url></sitemap>';
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      locs: ['https://dennikn.sk/blog/1/', 'https://dennikn.sk/blog/2/'],
    });
  });

  it('reads 50,000 entries', () => {
    const urls = Array.from(
      { length: 50_000 },
      (_, i) => `<url><loc>https://e.com/${i}</loc></url>`,
    );
    const r = parseSitemap(
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('\n')}</urlset>`,
    );
    expect(r.kind).toBe('urlset');
    expect(r.locs).toHaveLength(50_000);
  });

  it('reads namespace-prefixed elements, but only in the root namespace', () => {
    const xml = `<?xml version="1.0"?>
<!-- generated <urlset> by a plugin -->
<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <sm:url><sm:loc>https://e.com/a</sm:loc><image:image><image:loc>https://e.com/a.jpg</image:loc></image:image></sm:url>
</sm:urlset>`;
    expect(parseSitemap(xml)).toEqual({ kind: 'urlset', locs: ['https://e.com/a'] });
    expect(
      parseSitemap(
        '<ns0:sitemapindex xmlns:ns0="x"><ns0:sitemap><ns0:loc>https://e.com/s.xml</ns0:loc></ns0:sitemap></ns0:sitemapindex>',
      ),
    ).toEqual({ kind: 'index', locs: ['https://e.com/s.xml'] });
  });

  it('decodes numeric entities once, with a BOM and whitespace around <loc>', () => {
    const xml =
      '\uFEFF<urlset><url><loc >\n https://e.com/?a=1&#38;b=&#x32;&amp;lt; \n</loc ></url></urlset>';
    expect(parseSitemap(xml).locs).toEqual(['https://e.com/?a=1&b=2&lt;']);
  });

  it('reads a plain-text sitemap, one URL per line', () => {
    expect(parseSitemap('https://e.com/a\r\nhttps://e.com/b\n\n# not a url\n')).toEqual({
      kind: 'urlset',
      locs: ['https://e.com/a', 'https://e.com/b'],
    });
    expect(parseSitemap('Not found').kind).toBe('unknown');
  });

  it('reads what it can from a truncated or malformed file', () => {
    expect(
      parseSitemap('<urlset><url><loc>https://e.com/a</loc></url><url><loc>https://e.com/b</lo'),
    ).toEqual({ kind: 'urlset', locs: ['https://e.com/a'] });
  });
});

describe('listsUrl', () => {
  const locs = ['https://e.com/', 'https://e.com/blog/caf%C3%A9/', 'https://e.com/x?y=1'];
  it.each([
    ['https://e.com/blog/café', true],
    ['https://e.com/blog/caf%C3%A9#top', true],
    ['https://e.com', true],
    ['https://e.com/x?y=1', true],
    ['https://e.com/x', false],
    ['https://e.com/blog', false],
  ])('%s → %s', (url, listed) => {
    expect(listsUrl(locs, url)).toBe(listed);
  });
});

describe('sameUrl', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a/', true],
    ['https://example.com', 'https://example.com/', true],
    ['https://example.com/a#x', 'https://example.com/a', true],
    ['https://EXAMPLE.com/a', 'https://example.com/a', true],
    ['https://example.com/a', 'http://example.com/a', false],
    ['https://example.com/a?x=1', 'https://example.com/a', false],
    ['not a url', 'not a url', true],
  ])('%s vs %s → %s', (a, b, same) => {
    expect(sameUrl(a, b)).toBe(same);
  });
});

describe('defaultSitemaps', () => {
  it('lists the conventional locations', () => {
    expect(defaultSitemaps('https://example.com')).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap_index.xml',
    ]);
  });
});
