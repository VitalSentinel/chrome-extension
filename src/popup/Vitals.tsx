import type { TabVitals } from '../lib/types';
import { formatMetric, rate, type Metric, type Rating } from '../lib/vitals';
import { cx } from '../ui/kit';

// Core Web Vitals cards shared by Overview and Performance. The on-device value of this load
// leads; for a monitored site the latest CrUX p75 sits beneath.

export const RATING_TEXT: Record<Rating, string> = {
  good: 'text-good-text',
  'needs-improvement': 'text-warn-text',
  poor: 'text-poor-text',
};
const RATING_LABEL: Record<Rating, string> = {
  good: 'Good',
  'needs-improvement': 'Needs improvement',
  poor: 'Poor',
};

const RATING_MARK: Record<Rating, string> = { good: '✓', 'needs-improvement': '!', poor: '×' };

/** A metric value in its rating colour, with a mark so the rating never rests on colour alone. */
export function Rated({ metric, value }: { metric: Metric; value: number }) {
  const r = rate(metric, value);
  return (
    <span class={cx('whitespace-nowrap font-semibold', RATING_TEXT[r])} title={RATING_LABEL[r]}>
      {formatMetric(metric, value)} <span aria-hidden="true">{RATING_MARK[r]}</span>
      <span class="sr-only">{RATING_LABEL[r]}</span>
    </span>
  );
}

export interface VitalCard {
  metric: Metric;
  device?: number;
  crux?: number | null; // latest CrUX week once the app answered; null when it has none
  cruxLoading?: boolean; // the app is still answering: hold the CrUX rows' space
}

export function cardsFrom(
  vitals: TabVitals | null,
  metrics: Metric[] = ['LCP', 'INP', 'CLS'],
): VitalCard[] {
  return metrics.map((metric) => ({ metric, device: vitals?.metrics[metric]?.value }));
}

/**
 * Sibling cards share one grid and each card spans its rows as a subgrid, so the same row
 * (label, value, note, field line) lines up across cards whatever wraps. Callers
 * create only rows some card fills, so an unused row adds no gap.
 */
export function rowGrid(cols: number, rows: number) {
  return {
    parent: {
      gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
      gridTemplateRows: `repeat(${rows}, auto)`,
    },
    card: { gridRow: `span ${rows}`, gridTemplateRows: 'subgrid' },
  };
}
export const CARD = 'grid min-w-0 grid-cols-[minmax(0,1fr)] rounded-card border border-border';

const show = (c: VitalCard, v: number | undefined) =>
  v === undefined ? '–' : formatMetric(c.metric, v);

const missing = (c: VitalCard) =>
  c.metric === 'INP' ? 'Interact with the page first' : 'Not measured yet';

/** The card's foot: the latest CrUX p75, as large as it deserves, with its rating. */
function CruxLine({ c }: { c: VitalCard }) {
  if (c.cruxLoading)
    return (
      <div
        class="flex flex-col gap-1.5 border-t border-hairline pt-2.5"
        role="status"
        aria-label="Loading CrUX data"
      >
        <span class="skeleton block h-2.5 w-14" />
        <span class="skeleton block h-[19px] w-20" />
      </div>
    );
  if (c.crux === undefined) return <span />;
  const r = c.crux === null ? null : rate(c.metric, c.crux);
  return (
    <div class="flex items-end justify-between gap-2 border-t border-hairline pt-2.5">
      <span class="flex min-w-0 flex-col gap-1">
        <span class="text-2xs font-semibold text-ink-3">CrUX data</span>
        <span
          class={cx(
            'whitespace-nowrap font-display text-[19px] font-bold leading-none',
            r ? RATING_TEXT[r] : 'text-ink-3',
          )}
        >
          {c.crux === null ? 'No data' : formatMetric(c.metric, c.crux)}
        </span>
      </span>
      {r && (
        <span class={cx('whitespace-nowrap text-2xs font-semibold', RATING_TEXT[r])}>
          {RATING_LABEL[r]}
        </span>
      )}
    </div>
  );
}

/** Three large cards: this load, then the latest CrUX p75. */
export function VitalCards({ cards }: { cards: VitalCard[] }) {
  const has = {
    note: cards.some((c) => c.device === undefined),
    field: cards.some((c) => c.crux !== undefined || c.cruxLoading),
  };
  const g = rowGrid(cards.length, 2 + Number(has.note) + Number(has.field));
  return (
    <div class="grid gap-x-3.5 gap-y-2" style={g.parent}>
      {cards.map((c) => {
        const rating = c.device !== undefined ? rate(c.metric, c.device) : null;
        return (
          <div key={c.metric} class={cx(CARD, 'px-4 py-3.5')} style={g.card}>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span class="flex-grow whitespace-nowrap text-xs text-ink-2">
                <span class="font-semibold">{c.metric}</span> · This device
              </span>
              {rating && (
                <span class={cx('whitespace-nowrap text-2xs font-semibold', RATING_TEXT[rating])}>
                  {RATING_LABEL[rating]}
                </span>
              )}
            </div>
            <span
              class={cx(
                'whitespace-nowrap font-display text-[26px] font-bold leading-none',
                rating && RATING_TEXT[rating],
              )}
            >
              {show(c, c.device)}
            </span>
            {has.note && (
              <span class="text-2xs text-ink-3">{c.device === undefined ? missing(c) : ''}</span>
            )}
            {has.field && <CruxLine c={c} />}
          </div>
        );
      })}
    </div>
  );
}

/** A row of tiles for this load only; Performance shows five in two rows of three and two. */
export function MetricTiles({ cards }: { cards: VitalCard[] }) {
  const note = cards.some((c) => c.device === undefined);
  const g = rowGrid(cards.length, note ? 3 : 2);
  return (
    <div class="grid gap-x-3.5 gap-y-1.5" style={g.parent}>
      {cards.map((c) => {
        const rating = c.device !== undefined ? rate(c.metric, c.device) : null;
        return (
          <div key={c.metric} class={cx(CARD, 'px-4 py-3.5')} style={g.card}>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span class="flex-grow text-xs font-semibold text-ink-2">{c.metric}</span>
              {rating && (
                <span class={cx('whitespace-nowrap text-2xs font-semibold', RATING_TEXT[rating])}>
                  {RATING_LABEL[rating]}
                </span>
              )}
            </div>
            <span
              class={cx(
                'whitespace-nowrap font-display text-[24px] font-bold leading-tight',
                rating && RATING_TEXT[rating],
              )}
            >
              {show(c, c.device)}
            </span>
            {note && (
              <span class="text-2xs text-ink-3">{c.device === undefined ? missing(c) : ''}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
