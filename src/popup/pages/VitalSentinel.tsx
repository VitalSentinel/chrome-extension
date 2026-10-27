import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ok, type Section as ApiSection, type UrlOverview } from '../../lib/app';
import { appLink } from '../../lib/config';
import { ago, capital, compact, date, duration, pct } from '../../lib/format';
import { formatMetric, rate, type Metric } from '../../lib/vitals';
import { Card, ErrorNote, LEVEL_TEXT, LinkButton, Page, cx } from '../../ui/kit';
import {
  appError,
  cruxWeeks,
  emptyText,
  indexedLabel,
  useAppOverview,
  WatchButton,
} from '../appData';
import { send } from '../../lib/messages';
import type { PageKey } from '../nav';
import { ModuleIcon, SignInPitch, StartMonitoring } from '../Promo';
import type { PageProps } from '../types';
import { RATING_TEXT } from '../Vitals';

// The signed-in view of a monitored site: how this page is doing in the last 90 days, one tile
// per kind of data. The details sit in the report pages they belong to; the rest is in the app.

const value = (v: number | null | undefined, f: (n: number) => string) =>
  v === null || v === undefined ? '–' : f(v);

/** One kind of data: a few figures and where to see more. */
function Tile({
  title,
  module,
  s,
  more,
  retry,
  cols = 3,
  children,
}: {
  title: string;
  module: string;
  cols?: 3 | 4;
  s: ApiSection | undefined;
  more: { label: string; go?: () => void };
  retry: () => void;
  children: ComponentChildren;
}) {
  if (!s || s.status === 'not_in_scope') return null;
  return (
    <Card class="flex flex-col gap-3 px-4 py-3.5">
      <div class="flex items-center gap-2.5">
        <ModuleIcon name={module} />
        <h2 class="flex-grow font-semibold">{title}</h2>
        {more.go ? (
          <button
            type="button"
            class="text-xs font-medium text-accent-text hover:underline"
            onClick={more.go}
          >
            {more.label} ›
          </button>
        ) : (
          s.deep_link && (
            <a href={appLink(s.deep_link)} target="_blank" rel="noreferrer" class="text-xs">
              {more.label} ↗
            </a>
          )
        )}
      </div>
      {ok(s) ? (
        <div class={cx('grid gap-x-3 gap-y-2.5', cols === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
          {children}
        </div>
      ) : (s as ApiSection).status === 'timeout' ? (
        <p class="flex items-center gap-2 text-ink-2">
          The app took too long.
          <button
            type="button"
            class="font-medium text-accent-text hover:underline"
            onClick={retry}
          >
            Try again
          </button>
        </p>
      ) : (
        <p class="text-ink-2">{emptyText(s as ApiSection)}</p>
      )}
    </Card>
  );
}

function Figure({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <span class="flex min-w-0 flex-col gap-0.5">
      <span class="truncate text-xs text-ink-2" title={label}>
        {label}
      </span>
      <span class="truncate font-display text-[19px] font-bold leading-tight">{children}</span>
    </span>
  );
}

const CRUX: [Metric, string][] = [
  ['LCP', 'Largest Contentful Paint'],
  ['INP', 'Interaction to Next Paint'],
  ['CLS', 'Cumulative Layout Shift'],
];

const DEVICES = [
  ['PHONE', 'Phone'],
  ['DESKTOP', 'Desktop'],
] as const;

/** One panel per metric with the latest phone and desktop p75, coloured by rating. */
function CruxGrid({ crux }: { crux: UrlOverview['sections']['crux'] }) {
  return (
    <div class="col-span-full grid grid-cols-3 gap-2.5">
      {CRUX.map(([m, name]) => (
        <div
          class="flex min-w-0 flex-col gap-2 rounded-[10px] bg-surface-inset px-3 py-2.5"
          key={m}
        >
          <span class="truncate text-xs font-semibold text-ink-2" title={name}>
            {name}
          </span>
          {DEVICES.map(([ff, label]) => {
            const last = cruxWeeks(crux, m, ff).at(-1);
            const r = last ? rate(m, last.p75!) : null;
            return (
              <span class="flex items-baseline justify-between gap-2" key={ff}>
                <span class="text-xs text-ink-2">{label}</span>
                <span
                  class={cx(
                    'whitespace-nowrap font-display text-[17px] font-bold leading-tight',
                    r ? RATING_TEXT[r] : 'text-ink-3',
                  )}
                >
                  {last ? formatMetric(m, last.p75!) : '–'}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Summary({
  o,
  go,
  retry,
}: {
  o: UrlOverview;
  go: (p: PageKey) => void;
  retry: () => void;
}) {
  const { search_console: gsc, indexing, crux, web_analytics: wa } = o.sections;
  const [indexed, level] = indexedLabel(o);
  return (
    <div class="flex flex-col gap-3">
      <Tile
        title="Google Search Console"
        module="Google Search Console"
        cols={4}
        retry={retry}
        s={gsc}
        more={{ label: 'Queries', go: () => go('content') }}
      >
        {ok(gsc) && (
          <>
            <Figure label="Clicks">{value(gsc.clicks, compact)}</Figure>
            <Figure label="Impressions">{value(gsc.impressions, compact)}</Figure>
            <Figure label="CTR">{value(gsc.ctr, (n) => pct(n, 1))}</Figure>
            <Figure label="Average position">
              {value(gsc.average_position, (n) => n.toFixed(1))}
            </Figure>
          </>
        )}
      </Tile>
      <Tile
        title="Google index"
        module="Indexing monitoring"
        retry={retry}
        s={indexing}
        more={{ label: 'Indexability', go: () => go('indexability') }}
      >
        {ok(indexing) && (
          <>
            <Figure label="Status">
              <span class={cx(level && LEVEL_TEXT[level])}>{indexed}</span>
            </Figure>
            <Figure label="Last crawled by Google">
              {indexing.last_crawl_time ? date(indexing.last_crawl_time) : '–'}
            </Figure>
            <Figure label="Last checked">
              {(indexing.inspected_at ?? indexing.as_of)
                ? capital(ago((indexing.inspected_at ?? indexing.as_of)!))
                : '–'}
            </Figure>
          </>
        )}
      </Tile>
      <Tile
        title="CrUX data"
        module="CrUX monitoring"
        retry={retry}
        s={crux}
        more={{ label: 'Performance', go: () => go('performance') }}
      >
        <CruxGrid crux={crux} />
      </Tile>
      <Tile
        title="Web Analytics"
        module="Web Analytics"
        retry={retry}
        s={wa}
        more={{ label: 'Open in app' }}
      >
        {ok(wa) && (
          <>
            <Figure label="Page views">{value(wa.pageviews, compact)}</Figure>
            {wa.visitors !== undefined && (
              <Figure label="Visitors">{value(wa.visitors, compact)}</Figure>
            )}
            {wa.visits !== undefined && <Figure label="Visits">{value(wa.visits, compact)}</Figure>}
            <Figure label="Bounce rate">{value(wa.bounce_rate, (n) => pct(n, 1))}</Figure>
            {wa.views_per_visit !== undefined && (
              <Figure label="Views per visit">
                {value(wa.views_per_visit, (n) => n.toFixed(1))}
              </Figure>
            )}
            {wa.time_per_visit_s !== undefined && (
              <Figure label="Time per visit">{value(wa.time_per_visit_s, duration)}</Figure>
            )}
          </>
        )}
      </Tile>
    </div>
  );
}

/** The four tiles' shape while the app answers, so nothing moves when the data arrives. */
function SummarySkeleton() {
  return (
    <>
      <p class="-mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">Last 90 days</p>
      <div class="flex flex-col gap-3" role="status" aria-label="Loading your VitalSentinel data">
        {[0, 1, 2, 3].map((i) => (
          <Card class="flex flex-col gap-3 px-4 py-3.5" key={i}>
            <div class="flex items-center gap-2.5">
              <span class="skeleton h-7 w-7 rounded-[8px]" />
              <span class="skeleton h-3.5 w-28" />
            </div>
            <div class="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((j) => (
                <span class="flex flex-col gap-1.5 py-0.5" key={j}>
                  <span class="skeleton h-3 w-14" />
                  <span class="skeleton h-[22px] w-14" />
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/** The account is still loading, or its load failed: say which, with a way to try again. */
function AccountPending({ ctx, reload }: Pick<PageProps, 'ctx' | 'reload'>) {
  const [busy, setBusy] = useState(false);
  if (ctx.auth.pending === 'loading')
    return (
      <Page title="VitalSentinel">
        <SummarySkeleton />
      </Page>
    );
  return (
    <Page title="VitalSentinel">
      <ErrorNote>
        Could not load your VitalSentinel account.{' '}
        <button
          type="button"
          class="font-medium text-accent-text hover:underline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await send('auth:state', {}).catch(() => {});
            setBusy(false);
            reload();
          }}
        >
          {busy ? 'Trying…' : 'Try again'}
        </button>
      </ErrorNote>
    </Page>
  );
}

/** Host and path of the URL, for the line under the title. */
const where = (url: string) => {
  const u = new URL(url);
  return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
};

export default function VitalSentinel({ ctx, reload, go }: PageProps) {
  const monitored = ctx.monitored;
  const [reads, setReads] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // The re-read after a refresh starts loading only in the next effect: hold the skeleton.
  const [reread, setReread] = useState(false);
  const data = useAppOverview(ctx, ctx.url, reads);
  useEffect(() => {
    if (!data.loading) setReread(false);
  }, [data.loading]);
  // Past the cache once, then read the answer it left there.
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await send('app:overview', {
        domainId: monitored!.id,
        url: ctx.url,
        refresh: true,
        incognito: ctx.incognito,
      });
      if (!r.ok) setRefreshError(appError(r.status, r.error));
    } catch {
      setRefreshError('Could not load data. Try again.');
    }
    setReread(true);
    setRefreshing(false);
    setReads((n) => n + 1);
  };
  const loading = data.loading || refreshing || reread;

  if (!ctx.auth.signedIn) return <SignInPitch ctx={ctx} reload={reload} />;
  // Until the account and domain list are cached, "not monitored" would be a guess.
  if (!monitored && ctx.auth.pending) return <AccountPending ctx={ctx} reload={reload} />;
  if (!monitored) return <StartMonitoring ctx={ctx} reload={reload} />;

  const res = data.data;
  const o = res?.ok ? res.data : null;
  return (
    <Page
      title="VitalSentinel"
      aside={
        <span class="flex items-center gap-2.5">
          {o && <WatchButton o={o} ctx={ctx} />}
          <LinkButton href={appLink(`/dashboard/domains/${monitored.id}`)}>
            Open in app ↗
          </LinkButton>
        </span>
      }
    >
      <p class="-mt-3 flex min-w-0 items-baseline gap-1.5 text-xs text-ink-2">
        <span class="mono min-w-0 truncate" title={ctx.url}>
          {where(ctx.url)}
        </span>
        <span class="shrink-0 whitespace-nowrap">
          {o && !loading && `· Updated ${ago(o.generated_at)} `}·{' '}
          <button type="button" class="text-accent-text hover:underline" onClick={refresh}>
            Refresh
          </button>
        </span>
      </p>
      {loading && <SummarySkeleton />}
      {refreshError && !loading && <ErrorNote>{refreshError}</ErrorNote>}
      {data.error && <ErrorNote>Could not load data. Try again.</ErrorNote>}
      {res && !res.ok && <ErrorNote>{appError(res.status, res.error)}</ErrorNote>}
      {o && !loading && (
        <>
          <p class="-mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
            Last 90 days
          </p>
          <Summary o={o} go={go} retry={refresh} />
          <p class="text-xs text-ink-3">Full history and every module are in the app.</p>
        </>
      )}
      {o?.missing_scopes.length ? (
        <p class="text-xs text-ink-3">
          Some data needs more access: {o.missing_scopes.join(', ')}. Sign out and in again to grant
          it.
        </p>
      ) : null}
    </Page>
  );
}
