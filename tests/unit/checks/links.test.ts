import { describe, expect, it } from 'vitest';
import { classifyLinks } from '../../../src/lib/checks/links';
import { link } from '../fixtures';

const PAGE = 'https://www.example.com/page';

describe('classifyLinks', () => {
  it('classifies internal, external and rel values', () => {
    const r = classifyLinks(
      [
        link('https://www.example.com/a'),
        link('https://blog.example.com/b', { rel: 'nofollow noopener' }),
        link('https://partner.com/', { rel: 'sponsored nofollow' }),
        link('https://forum.com/u', { rel: 'ugc' }),
        link('https://www.example.com/a'),
      ],
      PAGE,
    );
    expect(r.rows.map((x) => [x.internal, x.nofollow, x.sponsored, x.ugc])).toEqual([
      [true, false, false, false],
      [true, true, false, false],
      [false, true, true, false],
      [false, false, false, true],
      [true, false, false, false],
    ]);
    expect(r).toMatchObject({ internal: 3, external: 2, nofollow: 2, unique: 4, emptyText: 0 });
    expect(r.findings).toEqual([{ id: 'links.internalNofollow', level: 'warn', params: { n: 1 } }]);
  });

  it('reports empty anchors and insecure links on https pages', () => {
    const links = [link('http://www.example.com/a', { text: '' }), link('http://other.com/')];
    expect(classifyLinks(links, PAGE).findings).toEqual([
      { id: 'links.emptyText', level: 'warn', params: { n: 1 } },
      { id: 'links.insecure', level: 'info', params: { n: 2 } },
    ]);
    expect(classifyLinks(links, 'http://www.example.com/').findings.map((f) => f.id)).toEqual([
      'links.emptyText',
    ]);
  });

  it('handles a page without links', () => {
    expect(classifyLinks([], PAGE)).toEqual({
      rows: [],
      internal: 0,
      external: 0,
      nofollow: 0,
      unique: 0,
      emptyText: 0,
      findings: [],
    });
  });
});
