import { describe, expect, it } from 'vitest';
import {
  contentFindings,
  headingSkips,
  metaValue,
  metaValues,
} from '../../../src/lib/checks/content';
import { ids, meta, snap } from '../fixtures';

const good = snap({
  title: 'x'.repeat(45),
  meta: meta({ description: 'd'.repeat(120), viewport: 'width=device-width' }),
  headings: [
    { level: 1, text: 'Main' },
    { level: 2, text: 'Sub' },
  ],
});

describe('meta helpers', () => {
  it('returns the first or all values for a key', () => {
    const s = snap({
      meta: [...meta({ robots: 'noindex' }), { key: 'robots', content: 'nofollow' }],
    });
    expect(metaValue(s, 'robots')).toBe('noindex');
    expect(metaValues(s, 'robots')).toEqual(['noindex', 'nofollow']);
    expect(metaValue(s, 'description')).toBeNull();
  });
});

describe('headingSkips', () => {
  it('reports each jump once and ignores the first heading level', () => {
    const levels = [3, 4, 2, 4, 2, 4, 3, 5, 6];
    expect(headingSkips(levels.map((level) => ({ level, text: '' })))).toEqual([
      [2, 4],
      [3, 5],
    ]);
  });

  it('allows going back up any number of levels', () => {
    expect(headingSkips([1, 2, 3, 4, 1, 2].map((level) => ({ level, text: '' })))).toEqual([]);
  });
});

describe('contentFindings', () => {
  it('passes a well-formed page', () => {
    expect(contentFindings(good)).toEqual([
      { id: 'title.ok', level: 'good', params: { n: 45 } },
      { id: 'description.ok', level: 'good', params: { n: 120 } },
    ]);
  });

  it.each([
    ['', 'title.missing'],
    ['x'.repeat(29), 'title.short'],
    ['x'.repeat(30), 'title.ok'],
    ['x'.repeat(60), 'title.ok'],
    ['x'.repeat(61), 'title.long'],
  ])('title of %#: %s', (title, id) => {
    expect(ids(contentFindings({ ...good, title }))[0]).toBe(id);
  });

  it.each([
    [null, 'description.missing'],
    ['d'.repeat(69), 'description.short'],
    ['d'.repeat(70), 'description.ok'],
    ['d'.repeat(160), 'description.ok'],
    ['d'.repeat(161), 'description.long'],
  ])('description case %#: %s', (description, id) => {
    const m = meta({
      viewport: 'width=device-width',
      ...(description === null ? {} : { description }),
    });
    expect(ids(contentFindings({ ...good, meta: m }))[1]).toBe(id);
  });

  it('checks H1 presence, count and text', () => {
    expect(ids(contentFindings({ ...good, headings: [] }))).toContain('h1.missing');
    const two = contentFindings({
      ...good,
      headings: [
        { level: 1, text: 'a' },
        { level: 1, text: 'b' },
      ],
    });
    expect(two).toContainEqual({ id: 'h1.multiple', level: 'warn', params: { n: 2 } });
    expect(ids(contentFindings({ ...good, headings: [{ level: 1, text: '' }] }))).toContain(
      'h1.empty',
    );
  });

  it('reports skips, missing lang and viewport, and thin content', () => {
    const s = {
      ...good,
      lang: '',
      meta: meta({ description: 'd'.repeat(100) }),
      wordCount: 120,
      headings: [
        { level: 1, text: 'a' },
        { level: 3, text: 'b' },
      ],
    };
    expect(contentFindings(s).slice(2)).toEqual([
      { id: 'heading.skip', level: 'warn', params: { from: 1, to: 3 } },
      { id: 'lang.missing', level: 'warn' },
      { id: 'viewport.missing', level: 'warn' },
      { id: 'content.thin', level: 'info', params: { n: 120 } },
    ]);
  });
});
