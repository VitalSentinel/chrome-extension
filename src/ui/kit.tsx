import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Finding, Level } from '../lib/types';
import { message } from '../i18n/findings';

// The shared building blocks of every report page: cards, tables, pills, buttons, switches.
// Pages compose these; they carry no data logic.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const LEVEL_TEXT: Record<Level, string> = {
  good: 'text-good-text',
  warn: 'text-warn-text',
  bad: 'text-poor-text',
  info: 'text-ink-2',
};
const LEVEL_ROW: Record<Level, string> = {
  good: '',
  warn: 'bg-warn-tint',
  bad: 'bg-poor-tint',
  info: '',
};
const LEVEL_PILL: Record<Level, string> = {
  good: 'bg-good-tint text-good-text',
  warn: 'bg-warn-tint text-warn-text',
  bad: 'bg-poor-tint text-poor-text',
  info: 'bg-hover text-ink-2',
};
const MARK: Record<Level, string> = { good: '✓', warn: '!', bad: '×', info: 'i' };

export function Page({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <div class="flex flex-col gap-[21px] px-7 pb-7 pt-[21px]">
      <div class="flex items-center gap-2.5">
        <h1 class="flex-grow font-display text-[22px] font-bold leading-tight">{title}</h1>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  aside,
  children,
}: {
  title: ComponentChildren;
  aside?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <section class="flex flex-col gap-2.5">
      <div class="flex items-baseline gap-2.5">
        <h2 class="flex-grow text-sm font-bold">{title}</h2>
        {aside && <span class="text-xs text-ink-2">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  class: c,
  tone,
}: {
  children: ComponentChildren;
  class?: string;
  tone?: Level;
}) {
  return (
    <div class={cx('rounded-card border border-border', tone && LEVEL_ROW[tone], c)}>
      {children}
    </div>
  );
}

export function Mark({ level }: { level: Level }) {
  return (
    <span class={cx('w-4 shrink-0 text-center font-bold', LEVEL_TEXT[level])} aria-hidden="true">
      {MARK[level]}
    </span>
  );
}

export function Pill({ level = 'info', children }: { level?: Level; children: ComponentChildren }) {
  return (
    <span
      class={cx(
        'inline-flex items-center rounded-pill px-2 py-0.5 text-[11.5px] font-semibold',
        LEVEL_PILL[level],
      )}
    >
      {children}
    </span>
  );
}

export function Chip({ children, mono }: { children: ComponentChildren; mono?: boolean }) {
  return (
    <span
      class={cx(
        'inline-flex items-center gap-2 rounded-pill border border-border px-3 py-1 font-medium',
        mono && 'mono',
      )}
    >
      {children}
    </span>
  );
}

/** Findings as a list of rows with ✓ ! × marks. */
export function Findings({ items, empty }: { items: Finding[]; empty?: string }) {
  if (!items.length) return empty ? <p class="text-ink-2">{empty}</p> : null;
  return (
    <Card class="divide-y divide-hairline overflow-hidden">
      {items.map((f) => (
        <div
          class={cx('flex gap-3 px-4 py-2.5', LEVEL_ROW[f.level])}
          key={f.id + JSON.stringify(f.params)}
        >
          <Mark level={f.level} />
          <span class={f.level === 'good' || f.level === 'info' ? '' : LEVEL_TEXT[f.level]}>
            {message(f)}
          </span>
        </div>
      ))}
    </Card>
  );
}

/** Label / value rows. */
export function KeyValues({ rows }: { rows: [ComponentChildren, ComponentChildren, Level?][] }) {
  return (
    <Card class="divide-y divide-hairline overflow-hidden">
      {rows.map(([k, v, level], i) => (
        <div
          class={cx(
            'grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-4 py-2.5',
            level && LEVEL_ROW[level],
          )}
          key={i}
        >
          <span class="text-ink-2">{k}</span>
          <span class={cx('min-w-0 break-words', level && level !== 'good' && LEVEL_TEXT[level])}>
            {v}
          </span>
        </div>
      ))}
    </Card>
  );
}

export interface Column<T> {
  label: string;
  width?: string; // grid track, default minmax(0,1fr)
  render: (row: T) => ComponentChildren;
}

/**
 * Full-width table, shown in full: the page is the only scroll area. An explicit `limit` shows
 * the first rows and a button for the rest.
 */
export function Table<T>({
  columns,
  rows,
  limit = Infinity,
  rowLevel,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  limit?: number;
  rowLevel?: (r: T) => Level | undefined;
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  const grid = { gridTemplateColumns: columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ') };
  if (!rows.length) return <Card class="px-4 py-3.5 text-ink-2">{empty ?? 'Nothing found.'}</Card>;
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <Card class="overflow-hidden">
      <div
        class="grid gap-3 border-b border-hairline bg-surface-inset px-4 py-2.5 text-[11.5px] font-semibold text-ink-2"
        style={grid}
      >
        {columns.map((c) => (
          <span key={c.label}>{c.label}</span>
        ))}
      </div>
      <div class="divide-y divide-hairline">
        {shown.map((r, i) => (
          <div
            class={cx(
              'grid items-start gap-3 px-4 py-2.5',
              rowLevel?.(r) && LEVEL_ROW[rowLevel(r)!],
            )}
            style={grid}
            key={i}
          >
            {columns.map((c) => (
              <div class="min-w-0 break-words" key={c.label}>
                {c.render(r)}
              </div>
            ))}
          </div>
        ))}
      </div>
      {rows.length > shown.length && (
        <button
          type="button"
          class="w-full border-t border-hairline px-4 py-2.5 text-left text-xs font-semibold text-accent-text hover:bg-hover"
          onClick={() => setAll(true)}
        >
          Show all {rows.length.toLocaleString('en')}
        </button>
      )}
    </Card>
  );
}

/**
 * A row of figures, e.g. counts or metrics. Each tile is a subgrid of the row, so a label or
 * sub line that wraps in one tile keeps the values and sub lines of its neighbours level.
 */
export function Stats({
  items,
}: {
  items: { label: string; value: ComponentChildren; level?: Level; sub?: ComponentChildren }[];
}) {
  const rows = items.some((s) => s.sub) ? 3 : 2;
  return (
    <Card class="grid">
      <div
        class="grid divide-x divide-hairline"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))`,
          gridTemplateRows: `repeat(${rows}, auto)`,
        }}
      >
        {items.map((s) => (
          <div
            class="grid content-start gap-0.5 px-4 py-3.5"
            style={{ gridRow: `span ${rows}`, gridTemplateRows: 'subgrid' }}
            key={s.label}
          >
            <span class="text-xs text-ink-2">{s.label}</span>
            <span
              class={cx(
                'font-display text-[22px] font-bold leading-tight',
                s.level && LEVEL_TEXT[s.level],
              )}
            >
              {s.value}
            </span>
            {s.sub && <span class="text-xs text-ink-2">{s.sub}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'secondary', size = 'sm', class: c, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      class={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        { sm: 'h-8 px-4 text-xs', md: 'h-9 px-4 text-sm', lg: 'h-12 px-8 text-[15px]' }[size],
        variant === 'primary' && 'bg-accent text-accent-on hover:bg-accent-hover',
        variant === 'secondary' && 'border border-border bg-surface text-ink hover:bg-hover',
        variant === 'ghost' && 'text-accent-text hover:bg-accent-tint',
        c as string,
      )}
      {...rest}
    />
  );
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  onClick,
}: {
  href: string;
  children: ComponentChildren;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target="_blank"
      rel="noreferrer"
      class={cx(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-pill px-4 text-xs font-semibold no-underline hover:no-underline',
        variant === 'primary'
          ? 'bg-accent text-accent-on hover:bg-accent-hover'
          : 'border border-border bg-surface text-ink hover:bg-hover',
      )}
    >
      {children}
    </a>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  large,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  large?: boolean; // the Terms screen and Settings
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      class={cx(
        'inline-flex shrink-0 items-center rounded-pill p-[3px] transition-colors disabled:opacity-50',
        large ? 'h-[24px] w-[42px]' : 'h-5 w-9',
        checked ? 'bg-accent' : 'bg-control',
      )}
    >
      {/* Centred by the flex row; travels the track's inner width minus its own. */}
      <span
        class={cx(
          'rounded-full bg-white shadow-sm transition-transform',
          large ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5',
          checked && (large ? 'translate-x-[18px]' : 'translate-x-4'),
        )}
      />
    </button>
  );
}

/** A row's click flips the switch inside it, so the whole row is the target, not just the knob. */
export function toggleRow(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
  (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[role="switch"]')?.click();
}

export function Select({
  value,
  onChange,
  options,
  label,
  class: c,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
  class?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      class={cx(
        'h-8 min-w-0 rounded-pill border border-control bg-surface px-3 pr-7 text-xs font-medium text-ink',
        c,
      )}
    >
      {options.map(([v, l]) => (
        <option value={v} key={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

const SKELETON_WIDTHS = ['62%', '78%', '54%', '70%', '46%', '66%'];

/** A pulsing status line over shimmering placeholder rows shaped like the report to come. */
export function Loading({ label = 'Analysing…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div class="flex flex-col gap-4 py-2">
      <div class="flex items-center gap-3 text-ink-2" role="status">
        <span class="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
          <span class="absolute h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
          <span class="relative h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        {label}
      </div>
      {rows > 0 && (
        <div aria-hidden="true">
          <Card class="divide-y divide-hairline overflow-hidden">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} class="flex items-center gap-5 px-4 py-4">
                <span class="skeleton h-3 w-24 shrink-0" />
                <span class="skeleton h-3" style={{ width: SKELETON_WIDTHS[i % 6] }} />
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: ComponentChildren }) {
  return (
    <Card tone="bad" class="px-4 py-3.5 text-poor-text">
      {children}
    </Card>
  );
}

/** A centred screen for a report that cannot be shown: what happened and what to do next. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  tone = 'info',
}: {
  icon: string[]; // 24 px line icon paths
  title: string;
  children: ComponentChildren;
  actions?: ComponentChildren;
  tone?: 'info' | 'bad';
}) {
  return (
    <div class="flex min-h-full flex-col items-center justify-center gap-3 px-12 py-10 text-center">
      <span
        class={cx(
          'mb-1 flex h-14 w-14 items-center justify-center rounded-full',
          tone === 'bad' ? 'bg-poor-tint text-poor-text' : 'bg-accent-tint text-accent-text',
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="h-6 w-6"
        >
          {icon.map((d) => (
            <path d={d} key={d} />
          ))}
        </svg>
      </span>
      <h1 class="font-display text-[22px] font-bold">{title}</h1>
      <div class="flex max-w-[460px] flex-col gap-2 leading-relaxed text-ink-2">{children}</div>
      {actions && <div class="mt-2 flex flex-wrap justify-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Note({ children }: { children: ComponentChildren }) {
  return <p class="text-xs text-ink-3">{children}</p>;
}

export function Banner({
  level,
  title,
  children,
}: {
  level: Level;
  title: ComponentChildren;
  children?: ComponentChildren;
}) {
  const dot = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-poor', info: 'bg-accent' }[level];
  return (
    <Card tone={level === 'info' ? undefined : level} class="flex items-start gap-3 px-4 py-3.5">
      <span class={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot)} />
      <div class="flex flex-col gap-0.5">
        <span
          class={cx(
            'text-[14px] font-semibold',
            LEVEL_TEXT[level === 'info' ? 'good' : level],
            level === 'info' && 'text-ink',
          )}
        >
          {title}
        </span>
        {children && <span class="text-ink-2">{children}</span>}
      </div>
    </Card>
  );
}

export { cx };
