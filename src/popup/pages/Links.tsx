import { useMemo, useRef, useState } from 'preact/hooks';
import { sameHost } from '../../lib/url';
import { classifyLinks, type LinkRow } from '../../lib/checks/links';
import { num } from '../../lib/format';
import type { Level } from '../../lib/types';
import { Button, cx, Findings, Note, Page, Section, Stats, Table, type Column } from '../../ui/kit';
import { linkStatuses } from '../data';
import type { PageProps } from '../types';

const MAX_CHECKS = 300;

type Filter = 'all' | 'internal' | 'external' | 'nofollow' | 'broken';

const statusLevel = (s: number): Level =>
  s >= 200 && s < 300 ? 'good' : s >= 300 && s < 400 ? 'warn' : 'bad';
const STATUS_PILL: Record<Level, string> = {
  good: 'bg-good-tint text-good-text',
  warn: 'bg-warn-tint text-warn-text',
  bad: 'bg-poor-solid text-white',
  info: 'bg-hover text-ink-2',
};
const isBroken = (s: number | undefined) => s !== undefined && statusLevel(s) === 'bad';

function Filters({
  value,
  onChange,
  options,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
  options: [Filter, string, number][];
}) {
  return (
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter links">
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
              : key === 'broken'
                ? 'border-poor/30 bg-poor-tint font-semibold text-poor-text hover:border-poor/60'
                : 'border-border bg-surface font-medium text-ink hover:bg-hover',
          )}
        >
          {label} {num(n)}
        </button>
      ))}
    </div>
  );
}

interface Run {
  urls: string[];
  running: boolean;
  error?: string;
}

export default function Links({ snap, settings }: PageProps) {
  const summary = useMemo(() => classifyLinks(snap.links, snap.url), [snap]);
  const [filter, setFilter] = useState<Filter>('all');
  const [status, setStatus] = useState<Record<string, number>>({});
  const [run, setRun] = useState<Run | null>(null);

  // Results arrive one by one; apply them once per frame so a long list re-renders rarely.
  const pending = useRef(new Map<string, number>());
  const frame = useRef(0);
  const onResult = (url: string, code: number) => {
    pending.current.set(url, code);
    frame.current ||= requestAnimationFrame(() => {
      frame.current = 0;
      const batch = Object.fromEntries(pending.current);
      pending.current.clear();
      setStatus((s) => ({ ...s, ...batch }));
    });
  };

  const broken = useMemo(
    () => summary.rows.filter((r) => isBroken(status[r.href])),
    [summary, status],
  );
  const filtered = useMemo(() => {
    if (filter === 'internal') return summary.rows.filter((r) => r.internal);
    if (filter === 'external') return summary.rows.filter((r) => !r.internal);
    if (filter === 'nofollow') return summary.rows.filter((r) => r.nofollow);
    if (filter === 'broken') return broken;
    return summary.rows;
  }, [summary, filter, broken]);

  // Offline mode allows requests to the site being viewed only.
  const targets = useMemo(
    () => [
      ...new Set(
        filtered
          .filter(
            (r) => /^https?:/.test(r.href) && (!settings.offline || sameHost(r.href, snap.url)),
          )
          .map((r) => r.href),
      ),
    ],
    [filtered, settings.offline, snap.url],
  );

  const check = () => {
    const urls = targets.slice(0, MAX_CHECKS);
    setRun({ urls, running: true });
    linkStatuses(urls, onResult).then(
      () => setRun({ urls, running: false }),
      (e: Error) => setRun({ urls, running: false, error: e.message || String(e) }),
    );
  };

  const checking = useMemo(() => new Set(run?.running ? run.urls : []), [run]);
  const done = run ? run.urls.filter((u) => u in status).length : 0;
  const options: [Filter, string, number][] = [
    ['all', 'All', summary.rows.length],
    ['internal', 'Internal', summary.internal],
    ['external', 'External', summary.external],
    ['nofollow', 'Nofollow', summary.nofollow],
    ...(broken.length ? [['broken', 'Broken', broken.length] as [Filter, string, number]] : []),
  ];

  const columns: Column<LinkRow>[] = [
    {
      label: 'Anchor · Target',
      render: (r) => (
        <div class="flex min-w-0 flex-col gap-0.5">
          {r.text ? (
            <span class="break-words">{r.text}</span>
          ) : (
            <span class="text-ink-3">No anchor text</span>
          )}
          {/^https?:/i.test(r.href) ? (
            <a
              href={r.href}
              target="_blank"
              rel="noreferrer"
              class="mono truncate text-[11px]"
              title={r.href}
            >
              {r.href}
            </a>
          ) : (
            <span class="mono truncate text-[11px] text-ink-2" title={r.href}>
              {r.href}
            </span>
          )}
        </div>
      ),
    },
    {
      label: 'Type',
      width: '90px',
      render: (r) => {
        const rel = [r.nofollow && 'nofollow', r.sponsored && 'sponsored', r.ugc && 'ugc'].filter(
          Boolean,
        );
        return (
          <span class="flex flex-col text-xs">
            {r.internal ? 'Internal' : 'External'}
            {rel.length > 0 && (
              <span
                class={cx(
                  'text-[11px]',
                  r.internal && r.nofollow ? 'text-warn-text' : 'text-ink-2',
                )}
              >
                {rel.join(' · ')}
              </span>
            )}
          </span>
        );
      },
    },
    {
      label: 'Status',
      width: '52px',
      render: (r) => {
        const s = status[r.href];
        if (s === undefined)
          return <span class="text-ink-3">{checking.has(r.href) ? '…' : '–'}</span>;
        return (
          <span
            class={cx(
              'mono block rounded px-1.5 py-px text-center text-[11px] font-bold',
              STATUS_PILL[statusLevel(s)],
            )}
          >
            {s || 'Error'}
          </span>
        );
      },
    },
  ];

  return (
    <Page title="Links">
      <Stats
        items={[
          { label: 'Total', value: num(summary.rows.length) },
          { label: 'Internal', value: num(summary.internal) },
          { label: 'External', value: num(summary.external) },
          { label: 'Nofollow', value: num(summary.nofollow) },
          { label: 'Unique', value: num(summary.unique) },
        ]}
      />

      <Findings items={summary.findings} />

      <Section title="All links">
        <div class="flex items-start gap-2.5">
          <div class="flex-grow">
            <Filters value={filter} onChange={setFilter} options={options} />
          </div>
          <Button onClick={check} disabled={run?.running || !targets.length}>
            {run?.running ? 'Checking…' : 'Check status'}
          </Button>
        </div>
        {run && (
          <p
            class={cx(
              'flex items-center gap-2 text-xs',
              run.error ? 'text-poor-text' : 'text-ink-2',
            )}
          >
            <span
              class={cx(
                'h-2 w-2 shrink-0 rounded-full',
                run.error ? 'bg-poor' : run.running ? 'animate-pulse bg-accent' : 'bg-good',
              )}
            />
            {run.error
              ? `The check stopped: ${run.error}`
              : `${run.running ? 'Checking' : 'Status checked for'} ${num(done)} of ${num(run.urls.length)} links · 6 at a time, straight from your browser`}
          </p>
        )}
        {targets.length > MAX_CHECKS && (
          <Note>Only the first {MAX_CHECKS} links of this list are checked.</Note>
        )}
        {settings.offline && (
          <Note>Offline mode is on, so only links on this host are checked.</Note>
        )}
        <Table
          columns={columns}
          rows={filtered}
          limit={100}
          rowLevel={(r) => (isBroken(status[r.href]) ? 'bad' : undefined)}
          empty={summary.rows.length ? 'No links match this filter.' : 'No links on this page.'}
        />
      </Section>
    </Page>
  );
}
