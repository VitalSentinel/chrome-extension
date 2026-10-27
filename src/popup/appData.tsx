import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  ok,
  unescapeHtml,
  type CruxSection,
  type Section as ApiSection,
  type UrlOverview,
} from '../lib/app';
import { appLink } from '../lib/config';
import { ago, capital, compact, date, num, pct } from '../lib/format';
import { send, type TabContext } from '../lib/messages';
import { formatMetric, type Metric } from '../lib/vitals';
import { BandChart } from '../ui/charts';
import { Button, Card, KeyValues, Pill, Section, Stats, Table, cx } from '../ui/kit';
import { track, useAsync } from './data';
import { Rated } from './Vitals';

// VitalSentinel's data for a monitored page, shown inside the report pages it belongs to:
// Google Search Console on Content, the Google index on Indexability, CrUX on Performance and a
// summary on Overview and the VitalSentinel tab, with Web Analytics. Every section covers the last 90 days; the
// app has the rest. The worker caches the answer, so each page asking for it costs nothing.

/** What a report page has of the app's data: the answer, or whether it is still coming. */
export interface AppView {
  o: UrlOverview | null;
  loading: boolean;
}

export const appView = (state: ReturnType<typeof useAppOverview>): AppView => ({
  o: state.data?.ok ? state.data.data : null,
  loading: state.loading,
});

/** Grey blocks of the section's size while the app answers, so nothing jumps when it does. */
export function SectionSkeleton({ title, height }: { title: string; height: number }) {
  return (
    <Section title={title}>
      <div
        role="status"
        aria-label={`Loading ${title}`}
        class="skeleton rounded-card"
        style={{ height: `${height}px` }}
      />
    </Section>
  );
}

/**
 * The url-overview answer for this page, or null when the site is not monitored. A new `reload`
 * value reads it again (from the cache a refresh just filled).
 */
export function useAppOverview(ctx: TabContext, url: string, reload = 0) {
  const monitored = ctx.monitored;
  return useAsync(
    () =>
      monitored
        ? send('app:overview', { domainId: monitored.id, url, incognito: ctx.incognito })
        : Promise.resolve(null),
    [monitored?.id, url, reload],
  );
}

/** A failed API call in plain words, for the popup to show. */
export function appError(status: number, error: string): string {
  if (error === 'offline') return 'Offline mode is on. Turn it off in Settings to load this.';
  if (error === 'terms') return 'Accept the Terms to load this.';
  if (error === 'signed_out' || status === 401) return 'Your session ended. Sign in again.';
  if (error === 'network' || status === 0) return 'Could not reach VitalSentinel. Try again.';
  if (status >= 500) return 'VitalSentinel had a problem. Try again in a moment.';
  if (status === 404) return 'VitalSentinel could not find this. Refresh and try again.';
  return 'The request did not go through. Try again.';
}

export function emptyText(s: ApiSection): string {
  if (s.status === 'not_connected') return 'Not set up for this domain yet.';
  if (s.status === 'timeout') return 'Took too long – try again.';
  if (!s.reason || !s.reason.includes(' ')) return 'No data yet.';
  // The app writes reasons in lower case without a stop: "this URL has not been inspected…"
  return capital(s.reason.trim()).replace(/([^.!?])$/, '$1.');
}

/** A section of app data: its scope, a link into the app, or why there is nothing. */
export function AppSection({
  title,
  s,
  children,
}: {
  title: string;
  s: ApiSection | undefined;
  children: ComponentChildren;
}) {
  if (!s || s.status === 'not_in_scope') return null;
  return (
    <Section
      title={title}
      aside={
        <span class="flex items-center gap-2.5 whitespace-nowrap">
          {ok(s) && s.scope === 'domain' && <Pill>Whole domain</Pill>}
          {s.deep_link ? (
            <a href={appLink(s.deep_link)} target="_blank" rel="noreferrer">
              Open in app ↗
            </a>
          ) : (
            s.as_of && `As of ${ago(s.as_of)}`
          )}
        </span>
      }
    >
      {ok(s) ? children : <Card class="px-4 py-3.5 text-ink-2">{emptyText(s)}</Card>}
    </Section>
  );
}

const value = (v: number | null | undefined, f: (n: number) => string) =>
  v === null || v === undefined ? '–' : f(v);

export function SearchConsole({ app: { o, loading } }: { app: AppView }) {
  if (!o)
    return loading ? (
      <SectionSkeleton title="Google Search Console · Last 90 days" height={240} />
    ) : null;
  const gsc = o.sections.search_console;
  return (
    <AppSection title="Google Search Console · Last 90 days" s={gsc}>
      {ok(gsc) && (
        <div class="flex flex-col gap-2.5">
          <Stats
            items={[
              { label: 'Clicks', value: value(gsc.clicks, compact) },
              { label: 'Impressions', value: value(gsc.impressions, compact) },
              { label: 'CTR', value: value(gsc.ctr, (n) => pct(n, 1)) },
              { label: 'Avg position', value: value(gsc.average_position, (n) => n.toFixed(1)) },
            ]}
          />
          {gsc.top_queries?.length ? (
            <Table
              columns={[
                { label: 'Top queries', render: (q) => unescapeHtml(q.query) },
                { label: 'Clicks', width: '70px', render: (q) => num(q.clicks) },
                { label: 'Impressions', width: '90px', render: (q) => num(q.impressions) },
                {
                  label: 'Pos.',
                  width: '50px',
                  render: (q) => q.average_position?.toFixed(1) ?? '–',
                },
              ]}
              rows={gsc.top_queries}
            />
          ) : null}
        </div>
      )}
    </AppSection>
  );
}

export function indexedLabel(o: UrlOverview): [string, 'good' | 'bad' | undefined] {
  const idx = o.sections.indexing;
  if (!ok(idx)) return ['–', undefined];
  if (idx.verdict === 'PASS') return ['Indexed', 'good'];
  if (idx.verdict === 'FAIL') return ['Not indexed', 'bad'];
  return [idx.coverage_state || '–', undefined];
}

export function GoogleIndex({ app: { o, loading } }: { app: AppView }) {
  if (!o) return loading ? <SectionSkeleton title="Google index" height={140} /> : null;
  const idx = o.sections.indexing;
  return (
    <AppSection title="Google index" s={idx}>
      {ok(idx) && (
        <KeyValues
          rows={[
            ['Status', idx.coverage_state ?? indexedLabel(o)[0], indexedLabel(o)[1]],
            [
              'Last Google crawl',
              idx.last_crawl_time
                ? `${date(idx.last_crawl_time)}${idx.crawled_as ? ` · ${capital(idx.crawled_as.toLowerCase())}` : ''}`
                : '–',
            ],
            [
              'Google canonical',
              idx.canonical_differs ? (idx.google_canonical ?? '–') : 'Same as declared',
              idx.canonical_differs ? 'warn' : undefined,
            ],
          ]}
        />
      )}
    </AppSection>
  );
}

/** One line for the Indexability verdict: whether Google really has the page, per Google Search Console. */
export function IndexedInGoogle({ app: { o, loading } }: { app: AppView }) {
  if (!o)
    return loading ? (
      <span
        role="status"
        aria-label="Loading the Google index status"
        class="skeleton mt-1.5 block h-3.5 w-72"
      />
    ) : null;
  const idx = o.sections.indexing;
  if (!ok(idx)) return null;
  const [label, level] = indexedLabel(o);
  if (label === '–') return null;
  const crawl = idx.last_crawl_time ? ` · Last crawled ${date(idx.last_crawl_time)}` : '';
  return (
    <span class="mt-1.5 block border-t border-hairline pt-1.5">
      <span
        class={cx(
          'font-semibold',
          level === 'good' ? 'text-good-text' : level === 'bad' ? 'text-poor-text' : 'text-ink',
        )}
      >
        {level === 'good' ? 'In Google’s index' : level === 'bad' ? 'Not in Google’s index' : label}
      </span>
      {level === 'bad' && idx.coverage_state ? ` – ${idx.coverage_state}` : ''}
      {crawl} · Google Search Console via VitalSentinel
    </span>
  );
}

/** p75 per collection, oldest first: the history when the app sends one, else the newest. */
export function cruxWeeks(crux: CruxSection | undefined, metric: string, formFactor = 'PHONE') {
  return ok(crux)
    ? (crux.history ?? crux.records)
        .filter((r) => r.metric === metric && r.form_factor === formFactor && r.p75 !== null)
        .sort((a, b) => a.collection_date.localeCompare(b.collection_date))
    : [];
}

export function CruxHistory({ app: { o, loading } }: { app: AppView }) {
  const [metric, setMetric] = useState<Metric>('LCP');
  if (!o)
    return loading ? (
      <SectionSkeleton title="CrUX data · Last 90 days · Phone" height={260} />
    ) : null;
  const crux = o.sections.crux;
  const weeks = cruxWeeks(crux, metric);
  const latest = weeks.at(-1);
  return (
    <AppSection title="CrUX data · Last 90 days · Phone" s={crux}>
      <Card class="flex flex-col gap-2.5 px-4 py-3.5">
        <div class="flex gap-1.5">
          {(['LCP', 'INP', 'CLS', 'TTFB'] as Metric[]).map((m) => (
            <Button
              key={m}
              variant={m === metric ? 'primary' : 'secondary'}
              onClick={() => setMetric(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        {weeks.length > 1 ? (
          <BandChart
            metric={metric}
            points={weeks.map((w) => ({ label: date(w.collection_date), value: w.p75! }))}
            format={(v) => formatMetric(metric, v)}
          />
        ) : latest ? (
          <p class="flex items-baseline gap-2 text-ink-2">
            Week of {date(latest.collection_date)}
            <span class="font-display text-[20px] font-bold">
              <Rated metric={metric} value={latest.p75!} />
            </span>
            <span class="text-xs">· The trend appears from the second week</span>
          </p>
        ) : (
          <p class="text-ink-2">No {metric} data for phones.</p>
        )}
      </Card>
    </AppSection>
  );
}

/** Adds this page to page monitoring, or stops watching it; owners and admins only. */
export function WatchButton({ o, ctx }: { o: UrlOverview; ctx: TabContext }) {
  const role = ctx.monitored ? ctx.auth.roles[ctx.monitored.workspace_id] : undefined;
  const canWrite = role === 'owner' || role === 'admin';
  const answered = (ok(o.sections.crawl) && o.sections.crawl.watch?.id) || null;
  const [watchId, setWatchId] = useState<string | null>(answered);
  // A newer answer (Refresh, another page) holds the watch state the app knows now.
  useEffect(() => setWatchId(answered), [answered, o.generated_at]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = (status: number, e: string) =>
    setError(
      status === 403
        ? 'Only workspace owners and admins can change watched pages'
        : e === 'limit_reached'
          ? 'Watched-page limit reached'
          : appError(status, e),
    );
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const domainId = ctx.monitored!.id;
      if (watchId) {
        const res = await send('app:unwatch', { domainId, watchId });
        // 404: the watch is already gone, which is what was asked for.
        if (res.ok || res.status === 404) setWatchId(null);
        else failed(res.status, res.error);
      } else {
        const res = await send('app:watch', { domainId, url: ctx.url });
        if (res.ok) {
          track('watch');
          setWatchId(res.data.watch.id);
        } else failed(res.status, res.error);
      }
    } catch {
      setError('The request did not go through. Try again.');
    }
    setBusy(false);
  };
  return (
    <span class="flex items-center gap-2.5">
      {error && <span class="text-xs text-poor-text">{error}</span>}
      {watchId && <Pill level="good">Watched</Pill>}
      <Button
        variant={watchId ? 'secondary' : 'primary'}
        disabled={!canWrite || busy}
        title={
          canWrite
            ? watchId
              ? 'Remove this URL from page monitoring'
              : 'Add this URL to page monitoring'
            : 'Only workspace owners and admins can change watched pages'
        }
        onClick={toggle}
      >
        {busy ? (watchId ? 'Stopping…' : 'Adding…') : watchId ? 'Stop watching' : 'Watch this page'}
      </Button>
    </span>
  );
}
