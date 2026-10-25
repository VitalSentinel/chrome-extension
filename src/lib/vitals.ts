import type { VitalSample } from './types';

export type Rating = VitalSample['rating'];
export type Metric = VitalSample['name'];

/** Google's thresholds: [good upper bound, poor lower bound]. */
export const THRESHOLDS: Record<Metric, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rate(metric: Metric, value: number): Rating {
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? 'good' : value > poor ? 'poor' : 'needs-improvement';
}

export function formatMetric(metric: Metric, value: number): string {
  if (metric === 'CLS') return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** The worst rating among the Core Web Vitals present, for the opt-in badge colour. */
export function overall(ratings: (Rating | undefined)[]): Rating | null {
  const present = ratings.filter((r): r is Rating => !!r);
  if (!present.length) return null;
  if (present.includes('poor')) return 'poor';
  return present.includes('needs-improvement') ? 'needs-improvement' : 'good';
}
