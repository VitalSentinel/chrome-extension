import { describe, expect, it } from 'vitest';
import { compareRaw } from '../../../src/lib/checks/raw';
import { ids, link, meta, snap } from '../fixtures';

const rendered = snap({
  title: 'Title',
  meta: meta({ description: 'Desc', robots: 'index, follow' }),
  canonicals: ['https://www.example.com/page'],
  headings: [{ level: 1, text: 'Hello' }],
  wordCount: 1000,
  links: Array.from({ length: 30 }, (_, i) => link(`https://www.example.com/${i}`)),
  jsonLd: ['{}'],
});

describe('compareRaw', () => {
  it('reports nothing when raw and rendered agree', () => {
    const r = compareRaw(rendered, rendered);
    expect(r.findings).toEqual([]);
    expect(r.rows.map((x) => x.field)).toEqual([
      'title',
      'description',
      'robots',
      'canonical',
      'h1',
      'words',
      'links',
      'jsonLd',
      'hreflang',
    ]);
    expect(r.rows.every((x) => !x.differs)).toBe(true);
    expect(r.rows.find((x) => x.field === 'words')).toEqual({
      field: 'words',
      raw: '1000',
      rendered: '1000',
      differs: false,
    });
  });

  it('rates robots and canonical changes as bad, title and description as warn', () => {
    const raw = {
      ...rendered,
      title: 'Loading…',
      meta: meta({ description: '', robots: 'noindex' }),
      canonicals: [],
    };
    expect(compareRaw(raw, rendered).findings).toEqual([
      { id: 'raw.changedByJs', level: 'warn', params: { field: 'title' } },
      { id: 'raw.changedByJs', level: 'warn', params: { field: 'description' } },
      { id: 'raw.changedByJs', level: 'bad', params: { field: 'robots' } },
      { id: 'raw.changedByJs', level: 'bad', params: { field: 'canonical' } },
    ]);
  });

  it('flags an H1, content and links that only exist after rendering', () => {
    const raw = { ...rendered, headings: [], wordCount: 100, links: rendered.links.slice(0, 10) };
    expect(ids(compareRaw(raw, rendered).findings)).toEqual([
      'raw.h1OnlyRendered',
      'raw.contentByJs',
      'raw.linksByJs',
    ]);
  });

  it('does not mark a link count that differs by a few links', () => {
    const many = Array.from({ length: 200 }, (_, i) => link(`https://www.example.com/${i}`));
    const page = { ...rendered, links: many };
    const row = (raw: number) =>
      compareRaw({ ...page, links: many.slice(0, raw) }, page).rows.find(
        (x) => x.field === 'links',
      )!;
    expect(row(199).differs).toBe(false);
    expect(row(181).differs).toBe(false); // within 10 %
    expect(row(179).differs).toBe(true);
    expect(
      compareRaw({ ...rendered, links: rendered.links.slice(0, 26) }, rendered).rows.find(
        (x) => x.field === 'links',
      )!.differs,
    ).toBe(false); // within 5 links
  });

  it('tolerates small word and link count differences', () => {
    const raw = { ...rendered, wordCount: 810, links: rendered.links.slice(0, 20) };
    const r = compareRaw(raw, rendered);
    expect(r.findings).toEqual([]);
    expect(r.rows.find((x) => x.field === 'links')?.differs).toBe(true); // differs, but not enough to report
    expect(
      compareRaw({ ...rendered, wordCount: 0 }, { ...rendered, wordCount: 50 }).findings,
    ).toEqual([]);
  });
});
