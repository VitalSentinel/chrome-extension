import { THRESHOLDS, type Metric } from '../lib/vitals';

// Small SVG charts drawn over Google's good / needs-improvement / poor bands. No chart
// library: these shapes are all the popup needs.

const BAND = {
  good: 'rgb(var(--good) / 0.12)',
  ni: 'rgb(var(--warn) / 0.14)',
  poor: 'rgb(var(--poor) / 0.12)',
};

function scale(metric: Metric, values: number[]) {
  const [, poor] = THRESHOLDS[metric];
  const max = Math.max(poor * 1.25, ...values) || 1;
  return (v: number) => 1 - Math.min(v, max) / max;
}

/** Larger history chart with band labels, for CrUX weeks. */
export function BandChart({
  metric,
  points,
  height = 140,
  format,
}: {
  metric: Metric;
  points: { label: string; value: number }[];
  height?: number;
  format: (v: number) => string;
}) {
  const width = 560;
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const y = scale(metric, values);
  const [good, poor] = THRESHOLDS[metric];
  const x = (i: number) => (i / (points.length - 1)) * width;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${(y(v) * height).toFixed(1)}`).join(' ');
  return (
    <div class="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        class="h-[140px] w-full"
        role="img"
        aria-label={`${metric} history, latest ${format(values.at(-1)!)}`}
      >
        <rect x="0" y="0" width={width} height={y(poor) * height} fill={BAND.poor} />
        <rect
          x="0"
          y={y(poor) * height}
          width={width}
          height={(y(good) - y(poor)) * height}
          fill={BAND.ni}
        />
        <rect
          x="0"
          y={y(good) * height}
          width={width}
          height={height - y(good) * height}
          fill={BAND.good}
        />
        <polyline
          points={pts}
          fill="none"
          stroke="rgb(var(--accent))"
          stroke-width="2.5"
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
        />
      </svg>
      <div class="flex justify-between text-2xs text-ink-3">
        <span>{points[0].label}</span>
        <span>
          Good ≤ {format(good)} · Poor &gt; {format(poor)}
        </span>
        <span>{points.at(-1)!.label}</span>
      </div>
    </div>
  );
}

/** Ring with a fraction, e.g. 7/10 checks passed. */
export function Ring({ value, max, size = 64 }: { value: number; max: number; size?: number }) {
  const c = 2 * Math.PI * 15;
  const share = max ? value / max : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      role="img"
      aria-label={`${value} of ${max}`}
    >
      <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(var(--track))" stroke-width="4" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke="rgb(var(--accent))"
        stroke-width="4"
        stroke-linecap="round"
        stroke-dasharray={`${share * c} ${c}`}
        transform="rotate(-90 18 18)"
      />
      <text
        x="18"
        y="21.5"
        text-anchor="middle"
        font-size="10"
        font-weight="700"
        fill="rgb(var(--ink))"
        font-family="Space Grotesk, Inter, sans-serif"
      >
        {value}/{max}
      </text>
    </svg>
  );
}

/** Share of good / needs improvement / poor as one bar. */
export function DistributionBar({ good, ni, poor }: { good: number; ni: number; poor: number }) {
  const total = good + ni + poor || 1;
  return (
    <div class="flex h-1.5 w-full overflow-hidden rounded-pill bg-track" aria-hidden="true">
      <span class="bg-good" style={{ width: `${(good / total) * 100}%` }} />
      <span class="bg-warn" style={{ width: `${(ni / total) * 100}%` }} />
      <span class="bg-poor" style={{ width: `${(poor / total) * 100}%` }} />
    </div>
  );
}
