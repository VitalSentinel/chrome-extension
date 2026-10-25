import { describe, expect, it } from 'vitest';
import { bufferedVitals, clsFromShifts, mergeVitals } from '../../src/lib/bufferedVitals';
import type { TabVitals } from '../../src/lib/types';

const shift = (startTime: number, value: number, hadRecentInput = false) => ({
  startTime,
  value,
  hadRecentInput,
});

describe('clsFromShifts', () => {
  it('takes the largest session window', () => {
    // Window 1: 0.05 + 0.05 (gap < 1 s); window 2 after a 2 s gap: 0.2.
    expect(clsFromShifts([shift(100, 0.05), shift(600, 0.05), shift(2700, 0.2)])).toBeCloseTo(0.2);
  });

  it('starts a new window after 5 s even without a gap', () => {
    const shifts = Array.from({ length: 12 }, (_, i) => shift(i * 500, 0.01));
    expect(clsFromShifts(shifts)).toBeCloseTo(0.1);
  });

  it('ignores shifts right after input', () => {
    expect(clsFromShifts([shift(100, 0.3, true), shift(200, 0.02)])).toBeCloseTo(0.02);
  });
});

describe('mergeVitals', () => {
  const live: TabVitals = {
    url: 'u',
    metrics: { LCP: { name: 'LCP', value: 1200, rating: 'good' } },
    shifts: [],
  };
  const fallback: TabVitals = {
    url: 'u',
    metrics: {
      LCP: { name: 'LCP', value: 9999, rating: 'poor' },
      FCP: { name: 'FCP', value: 800, rating: 'good' },
    },
    shifts: [],
  };

  it('keeps live values and fills the rest', () => {
    expect(mergeVitals(live, fallback)!.metrics).toEqual({
      LCP: live.metrics.LCP,
      FCP: fallback.metrics.FCP,
    });
  });

  it('uses the fallback alone, or nothing when it is empty', () => {
    expect(mergeVitals(null, fallback)).toBe(fallback);
    expect(mergeVitals(null, { url: 'u', metrics: {}, shifts: [] })).toBeNull();
    expect(mergeVitals(live, undefined)).toBe(live);
  });
});

describe('bufferedVitals', () => {
  function fakeWindow(
    entries: Record<string, { startTime: number; value?: number; hadRecentInput?: boolean }[]>,
    throws = false,
  ) {
    class Observer {
      constructor(private cb: (l: { getEntries: () => unknown[] }) => void) {}
      observe({ type }: { type: string }) {
        if (throws) throw new Error('unsupported');
        queueMicrotask(() => this.cb({ getEntries: () => entries[type] ?? [] }));
      }
      takeRecords() {
        return [];
      }
      disconnect() {}
    }
    return {
      PerformanceObserver: Observer,
      setTimeout: (f: () => void) => setTimeout(f, 0),
      performance: {
        getEntriesByName: (n: string) =>
          n === 'first-contentful-paint' ? [{ startTime: 640 }] : [],
        getEntriesByType: () => [{ responseStart: 180, startTime: 20 }],
      },
    } as unknown as Window;
  }

  it('reads LCP, CLS, FCP and TTFB from buffered entries', async () => {
    const v = await bufferedVitals(
      fakeWindow({
        'largest-contentful-paint': [{ startTime: 900 }, { startTime: 2600 }],
        'layout-shift': [{ startTime: 300, value: 0.12, hadRecentInput: false }],
      }),
      'https://example.com/',
    );
    expect(v.url).toBe('https://example.com/');
    expect(v.metrics.LCP).toEqual({ name: 'LCP', value: 2600, rating: 'needs-improvement' });
    expect(v.metrics.CLS?.value).toBeCloseTo(0.12);
    expect(v.metrics.FCP?.value).toBe(640);
    expect(v.metrics.TTFB?.value).toBe(160);
  });

  it('still reports paint and TTFB when observers are unsupported', async () => {
    const v = await bufferedVitals(fakeWindow({}, true), 'https://example.com/');
    expect(v.metrics.LCP).toBeUndefined();
    expect(v.metrics.CLS).toBeUndefined();
    expect(v.metrics.FCP?.value).toBe(640);
  });
});
