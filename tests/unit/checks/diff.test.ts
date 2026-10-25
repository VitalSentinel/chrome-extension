import { describe, expect, it } from 'vitest';
import { diffDigests, digest } from '../../../src/lib/checks/diff';
import { link, meta, nav, snap } from '../fixtures';

const page = snap({
  title: 'Title',
  meta: meta({ description: 'Desc', robots: 'nofollow, noindex' }),
  canonicals: ['https://www.example.com/page', 'https://www.example.com/other'],
  headings: [
    { level: 2, text: 'Intro' },
    { level: 1, text: 'Main' },
    { level: 1, text: 'Second' },
  ],
  wordCount: 800,
  jsonLd: ['[{"@type":"Product"},{"@type":"BreadcrumbList"}]', '{"@type":"Product"}', 'broken'],
  hreflang: [{ lang: 'de', href: 'https://www.example.de/' }],
  links: [link('https://www.example.com/a'), link('https://www.example.com/b')],
});

describe('digest', () => {
  it('keeps the SEO-relevant parts of a page', () => {
    expect(
      digest(page, nav({ status: 200, headers: [['X-Robots-Tag', 'noarchive']] }), 1234),
    ).toEqual({
      at: 1234,
      status: 200,
      title: 'Title',
      description: 'Desc',
      canonical: 'https://www.example.com/page',
      robots: 'noarchive, nofollow, noindex',
      h1: 'Main',
      words: 800,
      schema: 'BreadcrumbList, Product',
      hreflang: 1,
      links: 2,
    });
  });

  it('fills blanks for a bare page without navigation data', () => {
    expect(digest(snap({ wordCount: 0 }), null, 1)).toMatchObject({
      status: 0,
      description: '',
      canonical: '',
      robots: '',
      h1: '',
      schema: '',
    });
  });
});

describe('diffDigests', () => {
  const before = digest(page, nav(), 1);

  it('finds no changes between identical digests, ignoring the timestamp', () => {
    expect(diffDigests(before, { ...before, at: 2 })).toEqual([]);
  });

  it('lists changed fields in digest order', () => {
    const after = { ...before, status: 404, title: 'New title', robots: '' };
    expect(diffDigests(before, after)).toEqual([
      { field: 'status', before: '200', after: '404' },
      { field: 'title', before: 'Title', after: 'New title' },
      { field: 'robots', before: 'nofollow, noindex', after: '' },
    ]);
  });

  it('ignores small drift in word and link counts', () => {
    expect(diffDigests(before, { ...before, words: 880, links: 22 })).toEqual([]);
    expect(diffDigests(before, { ...before, words: 881, links: 23 })).toEqual([
      { field: 'words', before: '800', after: '881' },
      { field: 'links', before: '2', after: '23' },
    ]);
  });
});
