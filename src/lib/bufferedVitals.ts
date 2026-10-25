import type { TabVitals, VitalSample } from './types';
import { rate } from './vitals';

// Core Web Vitals read from the page's buffered performance entries when the popup opens.
// This covers loads the always-on collector missed: tabs opened before the extension was
// installed or updated, and pages where the collector's report did not arrive. INP needs
// interactions observed as they happen, so it is not available here.

type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };

/** CLS as Chrome defines it: the largest session window (gaps < 1 s, windows ≤ 5 s). */
export function clsFromShifts(
  shifts: { value: number; startTime: number; hadRecentInput: boolean }[],
): number {
  let max = 0;
  let current = 0;
  let first = 0;
  let last = 0;
  for (const s of shifts) {
    if (s.hadRecentInput) continue;
    if (current && s.startTime - last < 1000 && s.startTime - first < 5000) {
      current += s.value;
    } else {
      current = s.value;
      first = s.startTime;
    }
    last = s.startTime;
    max = Math.max(max, current);
  }
  return max;
}

function buffered<T extends PerformanceEntry>(type: string, win: Window): Promise<T[]> {
  return new Promise((resolve) => {
    const entries: T[] = [];
    try {
      const Observer = (win as Window & { PerformanceObserver: typeof PerformanceObserver })
        .PerformanceObserver;
      const po = new Observer((list) => entries.push(...(list.getEntries() as T[])));
      po.observe({ type, buffered: true });
      // Buffered entries arrive in the next task; give them one, then stop.
      win.setTimeout(() => {
        entries.push(...(po.takeRecords() as T[]));
        po.disconnect();
        resolve(entries);
      }, 50);
    } catch {
      resolve(entries);
    }
  });
}

const sample = (name: VitalSample['name'], value: number): VitalSample => ({
  name,
  value,
  rating: rate(name, value),
});

export async function bufferedVitals(win: Window, url: string): Promise<TabVitals> {
  const metrics: TabVitals['metrics'] = {};
  const [lcp, shifts] = await Promise.all([
    buffered<PerformanceEntry & { element?: Element }>('largest-contentful-paint', win),
    buffered<Shift>('layout-shift', win),
  ]);
  const lastLcp = lcp.at(-1);
  if (lastLcp) metrics.LCP = sample('LCP', lastLcp.startTime);
  if (shifts.length || lastLcp) metrics.CLS = sample('CLS', clsFromShifts(shifts));
  const fcp = win.performance.getEntriesByName('first-contentful-paint')[0];
  if (fcp) metrics.FCP = sample('FCP', fcp.startTime);
  const nav = win.performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  if (nav && nav.responseStart > 0)
    metrics.TTFB = sample('TTFB', Math.max(0, nav.responseStart - nav.startTime));
  return { url, metrics, shifts: [] };
}

/** The collector's numbers win; buffered ones fill whatever it did not report. */
export function mergeVitals(
  live: TabVitals | null,
  fallback: TabVitals | undefined,
): TabVitals | null {
  if (!fallback) return live;
  if (!live) return Object.keys(fallback.metrics).length ? fallback : null;
  return { ...live, metrics: { ...fallback.metrics, ...live.metrics } };
}
