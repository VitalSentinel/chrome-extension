import { useMemo, useState } from 'preact/hooks';
import { analyseImages, type ImageRow } from '../../lib/checks/images';
import { bytes, num, capital } from '../../lib/format';
import type { Level } from '../../lib/types';
import { Banner, cx, Findings, Page, Pill, Section, Stats, Table, type Column } from '../../ui/kit';
import type { PageProps } from '../types';
import { sameHost } from '../../lib/url';

const ISSUES: [id: string, label: string, level: Level][] = [
  ['img.altMissing', 'Missing alt', 'warn'],
  ['img.oversized', 'Oversized', 'warn'],
  ['img.noDimensions', 'No width or height', 'warn'],
  ['img.lazyAboveFold', 'Lazy above the fold', 'warn'],
  ['img.notLazy', 'Not lazy', 'info'],
  ['img.legacyFormat', 'Legacy format', 'info'],
];
const ISSUE = Object.fromEntries(ISSUES.map(([id, label, level]) => [id, { label, level }]));

function Filters({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string, number][];
}) {
  return (
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter images">
      {options.map(([key, label, n]) => (
        <button
          type="button"
          key={key}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          class={cx(
            'h-7 rounded-pill border px-2.5 text-xs',
            value === key
              ? 'border-accent/40 bg-accent-tint font-semibold text-accent-text'
              : 'border-border bg-surface font-medium text-ink hover:bg-hover',
          )}
        >
          {label} {num(n)}
        </button>
      ))}
    </div>
  );
}

const size = (w: number, h: number) => `${num(w)} × ${num(h)}`;
const hide = (e: Event) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden');
const MODERN = new Set(['webp', 'avif', 'svg']);

type Row = ImageRow & { thumb: boolean };

const details = (r: ImageRow) =>
  [
    r.naturalWidth ? size(r.naturalWidth, r.naturalHeight) : '',
    r.renderedWidth ? `shown ${size(r.renderedWidth, r.renderedHeight)}` : 'not shown',
    r.format.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');

const columns: Column<Row>[] = [
  {
    label: 'Image',
    width: '56px',
    render: (r) =>
      r.thumb ? (
        <img
          referrerpolicy="no-referrer"
          src={r.src}
          alt=""
          loading="lazy"
          decoding="async"
          class="h-10 w-14 rounded-md bg-surface-inset object-contain"
          onError={hide}
        />
      ) : (
        <span
          class="block h-10 w-14 rounded-md bg-surface-inset"
          title="Not loaded in offline mode"
        />
      ),
  },
  {
    label: 'Alt text · URL',
    render: (r) => (
      <div class="flex min-w-0 flex-col gap-0.5">
        {r.alt === null ? (
          <span class="font-semibold text-poor-text">Missing alt attribute</span>
        ) : r.alt === '' ? (
          <span class="font-semibold text-warn-text">
            Empty alt text <span class="font-normal text-ink-3">– fine if decorative</span>
          </span>
        ) : (
          <span class="break-words">{r.alt}</span>
        )}
        {r.src.startsWith('data:') ? (
          <span class="mono truncate text-[11px] text-ink-2" title={r.src.slice(0, 200)}>
            {r.src.slice(0, 80)}
          </span>
        ) : (
          <a
            href={r.src}
            target="_blank"
            rel="noreferrer"
            class="mono truncate text-[11px]"
            title={r.src}
          >
            {r.src}
          </a>
        )}
        <span class="text-[11.5px] text-ink-3">{details(r)}</span>
        {r.issues.some((id) => id !== 'img.altMissing') && (
          <span class="flex flex-wrap gap-1 pt-0.5">
            {r.issues
              .filter((id) => id !== 'img.altMissing')
              .map((id) => (
                <Pill level={ISSUE[id]?.level} key={id}>
                  {ISSUE[id]?.label ?? id}
                </Pill>
              ))}
          </span>
        )}
      </div>
    ),
  },
  {
    label: 'Size',
    width: '84px',
    render: (r) =>
      r.bytes ? (
        <span class="flex flex-col text-xs">
          <span class={cx(r.savings > 0 && 'font-semibold text-warn-text')}>{bytes(r.bytes)}</span>
          {r.savings > 0 && <span class="text-[11px] text-ink-3">−{bytes(r.savings)}</span>}
        </span>
      ) : (
        <span class="text-xs text-ink-3" title="The file size is unknown for this host">
          –
        </span>
      ),
  },
  {
    label: 'Loading',
    width: '64px',
    render: (r) => <span class="text-xs">{capital(r.loading || 'eager')}</span>,
  },
];

/** What the estimate is made of, e.g. "resizing 6 images … and serving 4 as WebP". */
function savingsNote(rows: ImageRow[]): string {
  const known = rows.filter((r) => r.savings > 0);
  const resized = known.filter(
    (r) =>
      r.renderedWidth > 0 &&
      r.naturalWidth * r.naturalHeight > 4 * r.renderedWidth * r.renderedHeight,
  ).length;
  const converted = known.filter((r) => !MODERN.has(r.format)).length;
  const images = (n: number) => `${num(n)} ${n === 1 ? 'image' : 'images'}`;
  const parts = [
    resized && `resizing ${images(resized)} to twice their shown size`,
    converted &&
      `serving ${images(converted)} in older formats as WebP or AVIF (about 30% smaller)`,
  ].filter(Boolean);
  return `By ${parts.join(' and ')}. Only images whose file size the page could read count.`;
}

export default function Images({ snap, settings }: PageProps) {
  const { rows, findings, savings } = useMemo(() => {
    const a = analyseImages(snap.images);
    // Offline mode: only the page's own site is contacted, so no thumbnails from other hosts.
    return {
      ...a,
      rows: a.rows.map((r) => ({ ...r, thumb: !settings.offline || sameHost(r.src, snap.url) })),
    };
  }, [snap, settings.offline]);
  const [filter, setFilter] = useState('all');

  const stats = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(
      ISSUES.map(([id]) => [id, rows.filter((r) => r.issues.includes(id)).length]),
    );
    const known = rows.filter((r) => r.bytes);
    return { counts, total: known.reduce((a, r) => a + r.bytes, 0), known: known.length };
  }, [rows]);

  const n = (id: string) => stats.counts[id] ?? 0;
  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.issues.includes(filter))),
    [rows, filter],
  );
  const options: [string, string, number][] = [
    ['all', 'All', rows.length],
    ...ISSUES.filter(([id]) => n(id)).map(([id, label]): [string, string, number] => [
      id,
      label,
      n(id),
    ]),
  ];
  const level = (count: number): Level => (count ? 'warn' : 'good');

  return (
    <Page title="Images">
      {savings > 0 && (
        <Banner
          level="warn"
          title={`About ${bytes(savings)} (${Math.round((savings / stats.total) * 100)}%) could be saved`}
        >
          {savingsNote(rows)}
        </Banner>
      )}

      <Stats
        items={[
          {
            label: 'Images',
            value: num(rows.length),
            sub: stats.known ? `${bytes(stats.total)} known` : undefined,
          },
          {
            label: 'Missing alt',
            value: num(n('img.altMissing')),
            level: level(n('img.altMissing')),
          },
          {
            label: 'Oversized',
            value: num(n('img.oversized')),
            level: level(n('img.oversized')),
          },
          { label: 'Legacy format', value: num(n('img.legacyFormat')) },
        ]}
      />

      <Findings items={findings} />

      <Section title="All images">
        {rows.length > 0 && <Filters value={filter} onChange={setFilter} options={options} />}
        <Table
          columns={columns}
          rows={filtered}
          limit={100}
          rowLevel={(r) => (r.alt === null ? 'bad' : r.alt === '' ? 'warn' : undefined)}
          empty={rows.length ? 'No images match this filter.' : 'No images on this page.'}
        />
      </Section>
    </Page>
  );
}
