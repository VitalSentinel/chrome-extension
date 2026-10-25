import { describe, expect, it } from 'vitest';
import { formatMetric, overall, rate } from '../../src/lib/vitals';

describe('rate', () => {
  it.each([
    ['LCP', 2500, 'good'],
    ['LCP', 2501, 'needs-improvement'],
    ['LCP', 4000, 'needs-improvement'],
    ['LCP', 4001, 'poor'],
    ['INP', 200, 'good'],
    ['INP', 501, 'poor'],
    ['CLS', 0.1, 'good'],
    ['CLS', 0.25, 'needs-improvement'],
    ['CLS', 0.26, 'poor'],
    ['FCP', 1800, 'good'],
    ['TTFB', 1801, 'poor'],
  ] as const)('%s %d → %s', (metric, value, rating) => {
    expect(rate(metric, value)).toBe(rating);
  });
});

describe('formatMetric', () => {
  it('shows CLS unitless and times in ms or s', () => {
    expect(formatMetric('CLS', 0.1234)).toBe('0.12');
    expect(formatMetric('INP', 180.4)).toBe('180 ms');
    expect(formatMetric('LCP', 2500)).toBe('2.5 s');
  });
});

describe('overall', () => {
  it('is null with no ratings', () => {
    expect(overall([])).toBeNull();
    expect(overall([undefined, undefined])).toBeNull();
  });

  it('returns the worst rating present', () => {
    expect(overall(['good', undefined])).toBe('good');
    expect(overall(['good', 'needs-improvement'])).toBe('needs-improvement');
    expect(overall(['needs-improvement', 'poor', 'good'])).toBe('poor');
  });
});
