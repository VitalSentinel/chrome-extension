import { describe, expect, it } from 'vitest';
import { analyseImages, estimateSavings, formatOf } from '../../../src/lib/checks/images';
import { image } from '../fixtures';

describe('formatOf', () => {
  it.each([
    ['https://a.com/x.JPEG?w=1', 'jpg'],
    ['https://a.com/x.jpg', 'jpg'],
    ['https://a.com/x.png#frag', 'png'],
    ['https://a.com/x.webp', 'webp'],
    ['https://a.com/image', ''],
    ['https://a.com/dir.v2/image', ''],
    ['data:image/svg+xml;base64,AAA', 'svg'],
    ['data:image/jpeg;base64,AAA', 'jpg'],
    ['data:image/AVIF;base64,AAA', 'avif'],
  ])('%s → %s', (src, format) => {
    expect(formatOf(src)).toBe(format);
  });
});

describe('estimateSavings', () => {
  const big = image({
    bytes: 100_000,
    naturalWidth: 2000,
    naturalHeight: 1000,
    renderedWidth: 500,
    renderedHeight: 250,
  });

  it('combines resizing to 2x and a modern format', () => {
    expect(estimateSavings(big, 'jpg')).toBe(82_500); // 100k × 0.25 × 0.7 = 17.5k left
    expect(estimateSavings(big, 'webp')).toBe(75_000);
  });

  it('only counts the format when the image is not oversized', () => {
    expect(
      estimateSavings(
        { ...big, naturalWidth: 800, naturalHeight: 600, renderedWidth: 400, renderedHeight: 300 },
        'png',
      ),
    ).toBe(30_000);
    expect(estimateSavings({ ...big, renderedWidth: 0, renderedHeight: 0 }, 'png')).toBe(30_000);
  });

  it('is zero for unknown sizes and SVG', () => {
    expect(estimateSavings({ ...big, bytes: 0 }, 'jpg')).toBe(0);
    expect(estimateSavings(big, 'svg')).toBe(0);
    expect(estimateSavings({ ...big, naturalWidth: 500, naturalHeight: 250 }, 'avif')).toBe(0);
  });
});

describe('analyseImages', () => {
  it('passes a well-formed image', () => {
    expect(analyseImages([image()])).toMatchObject({
      findings: [],
      savings: 0,
      rows: [{ format: 'webp', oversized: false, issues: [] }],
    });
  });

  it('skips empty sources and tracking GIFs', () => {
    expect(
      analyseImages([image({ src: '' }), image({ src: 'data:image/gif;base64,R0lGOD' })]).rows,
    ).toEqual([]);
  });

  it('collects issues per image and counts them', () => {
    const r = analyseImages([
      image({
        src: 'https://a.com/hero.jpg',
        alt: null,
        heightAttr: false,
        aboveFold: true,
        loading: 'lazy',
        bytes: 300_000,
        naturalWidth: 3000,
        naturalHeight: 2000,
        renderedWidth: 1000,
        renderedHeight: 667,
      }),
      image({ src: 'https://a.com/b.png', alt: '', widthAttr: false, loading: '', bytes: 10_000 }),
      image({ src: 'https://a.com/c.png', loading: 'eager', renderedWidth: 0, renderedHeight: 0 }),
      image({ naturalWidth: 390, renderedWidth: 100 }),
    ]);
    expect(r.rows.map((x) => x.issues)).toEqual([
      [
        'img.altMissing',
        'img.noDimensions',
        'img.oversized',
        'img.legacyFormat',
        'img.lazyAboveFold',
      ],
      ['img.noDimensions', 'img.notLazy'],
      [],
      [],
    ]);
    expect(r.findings).toEqual([
      { id: 'img.altMissing', level: 'warn', params: { n: 1 } },
      { id: 'img.noDimensions', level: 'warn', params: { n: 2 } },
      { id: 'img.oversized', level: 'warn', params: { n: 1 } },
      { id: 'img.legacyFormat', level: 'info', params: { n: 1 } },
      { id: 'img.lazyAboveFold', level: 'warn', params: { n: 1 } },
      { id: 'img.notLazy', level: 'info', params: { n: 1 } },
    ]);
    expect(r.savings).toBe(r.rows[0]!.savings + r.rows[1]!.savings);
    expect(r.savings).toBeGreaterThan(0);
  });
});
