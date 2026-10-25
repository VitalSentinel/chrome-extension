import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { ok, type Section as ApiSection, type UrlOverview } from '../../lib/app';
import { contentFindings, metaValue } from '../../lib/checks/content';
import { headerFindings } from '../../lib/checks/headers';
import { indexability, robotsDirectives } from '../../lib/checks/indexability';
import { redirectFindings } from '../../lib/checks/redirects';
import { isAllowed, robotsUnavailable } from '../../lib/checks/robots';
import { parseJsonLd } from '../../lib/checks/schema';
import { socialFindings } from '../../lib/checks/social';
import { analyseImages } from '../../lib/checks/images';
import { auditResources } from '../../lib/checks/resources';
import { ago, bytes, compact, date, ms, num, pct } from '../../lib/format';
import type { Finding, Level } from '../../lib/types';
import type { Metric } from '../../lib/vitals';
import { message } from '../../i18n/findings';
import { Card, KeyValues, LEVEL_TEXT, Mark, Page, Pill, Section, cx } from '../../ui/kit';
import { changesSinceLastVisit, robots, useAsync } from '../data';
import { GROUPS, type PageKey } from '../nav';
import type { PageProps } from '../types';
import { cardsFrom, VitalCards, type VitalCard } from '../Vitals';
import { CruxOffer, MonitorPromo } from '../Promo';
import {
  appView,
  cruxWeeks,
  emptyText,
  indexedLabel,
  useAppOverview,
  WatchButton,
} from '../appData';
import mark from '../../assets/logo-mark.svg';

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Meta description',
  canonical: 'Canonical',
  robots: 'Robots directives',
  h1: 'H1',
  words: 'Word count',
  schema: 'Structured data',
  hreflang: 'hreflang entries',
  links: 'Links',
  status: 'HTTP status',
};
const UNCHANGED: Record<string, string> = {
  title: 'title',
  description: 'description',
  canonical: 'canonical',
  robots: 'robots',
  h1: 'H1',
  schema: 'schema',
};
const PAGE_LABEL = Object.fromEntries(
  GROUPS.flatMap((g) => g.pages.map((p) => [p.key, p.label])),
) as Record<PageKey, string>;
const REASON: Record<number, string> = { 200: 'OK', 301: 'Moved', 302: 'Found', 404: 'Not found' };

/** This load leads; the latest CrUX p75 sits beneath. */
function monitoredCards(o: UrlOverview | null, base: VitalCard[]): VitalCard[] | null {
  if (!o || !ok(o.sections.crux)) return null;
  return base.map((c) => ({
    metric: c.metric as Metric,
    device: c.device,
    crux: cruxWeeks(o.sections.crux, c.metric).at(-1)?.p75 ?? null,
  }));
}

interface StripCell {
  value: number | string | null;
  unit?: string; // after a number: "clicks", "page views"
  level?: Level;
  notes: string[]; // only what the app measured
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;

// Why a source has nothing; a section the sign-in cannot read stays a plain dash, as it is
// hidden on the report pages.
const shown = (s: ApiSection | undefined) => (s && s.status !== 'not_in_scope' ? emptyText(s) : '');

/** One cell per source, each opening the report that has its detail. */
function stripCells(o: UrlOverview): StripCell[] {
  const { search_console: gsc, indexing: idx, web_analytics: wa } = o.sections;
  const [indexed, level] = indexedLabel(o);
  return [
    ok(gsc)
      ? {
          value: has(gsc.clicks) ? compact(gsc.clicks) : null,
          unit: 'clicks',
          notes: [
            has(gsc.impressions) ? `${compact(gsc.impressions)} impressions` : '',
            has(gsc.average_position) ? `Position ${gsc.average_position.toFixed(1)}` : '',
          ],
        }
      : { value: null, notes: [shown(gsc)] },
    ok(idx)
      ? {
          value: indexed === '–' ? null : indexed,
          level,
          notes: [idx.last_crawl_time ? `Last crawled ${date(idx.last_crawl_time)}` : ''],
        }
      : { value: null, notes: [shown(idx)] },
    ok(wa)
      ? {
          value: has(wa.pageviews) ? compact(wa.pageviews) : null,
          unit: 'page views',
          notes: [has(wa.bounce_rate) ? `Bounce rate ${pct(wa.bounce_rate, 1)}` : ''],
        }
      : { value: null, notes: [shown(wa)] },
  ].map((c) => ({ ...c, notes: c.notes.filter(Boolean) }));
}

const SOURCES: [string, PageKey][] = [
  ['Google Search Console', 'content'],
  ['Google index', 'indexability'],
  ['Web Analytics', 'vs-all'],
];

/** The last 90 days in VitalSentinel; grey placeholders of the same size while the app answers. */
function MonitoredStrip({ o, go }: { o: UrlOverview | null } & Pick<PageProps, 'go'>) {
  const cells = o ? stripCells(o) : null;
  return (
    <section class="overflow-hidden rounded-card border-[1.5px] border-accent/40">
      <button
        type="button"
        class="flex w-full items-center gap-2.5 bg-accent-tint px-4 py-2.5 text-left hover:bg-accent-tint/70"
        onClick={() => go('vs-all')}
      >
        <img src={mark} alt="" class="h-4 w-4" />
        <span class="flex-grow font-semibold text-accent-text">
          Monitored in VitalSentinel · Last 90 days
        </span>
        <span class="text-xs text-accent-text">VitalSentinel tab ›</span>
      </button>
      <div class="grid grid-cols-3 divide-x divide-hairline">
        {SOURCES.map(([source, page], i) => {
          const c = cells?.[i];
          return (
            <button
              type="button"
              class="group flex min-w-0 flex-col gap-2.5 px-4 pb-4 pt-3.5 text-left hover:bg-surface-inset"
              onClick={() => go(page)}
              key={source}
            >
              <span class="flex items-center gap-2">
                <span class="min-w-0 flex-grow truncate text-xs font-semibold text-ink-2">
                  {source}
                </span>
                <span class="text-ink-3 group-hover:text-accent-text" aria-hidden="true">
                  ›
                </span>
              </span>
              {c ? (
                <span class="flex min-w-0 flex-col gap-1">
                  <span
                    class={cx(
                      'flex items-baseline gap-1.5 truncate font-display text-[22px] font-bold leading-tight',
                      c.level && LEVEL_TEXT[c.level],
                    )}
                  >
                    {c.value ?? <span class="text-ink-3">–</span>}
                    {c.value !== null && c.unit && (
                      <span class="font-sans text-sm font-medium text-ink-2">{c.unit}</span>
                    )}
                  </span>
                  <span class="flex min-h-[32px] flex-col text-xs leading-normal text-ink-3">
                    {c.notes.map((n) => (
                      <span class="truncate" key={n}>
                        {n}
                      </span>
                    ))}
                  </span>
                </span>
              ) : (
                <span class="flex flex-col gap-1">
                  <span class="skeleton my-[3px] block h-[22px] w-28" aria-hidden="true" />
                  <span class="skeleton block h-3 w-32" aria-hidden="true" />
                  <span class="mb-[14px]" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A value with a muted second line, e.g. the title and its length. */
const Two = ({ a, b, level }: { a: ComponentChildren; b: string; level?: Level }) => (
  <span class="flex flex-col gap-0.5">
    <span>{a}</span>
    <span class={cx('text-xs', level && level !== 'good' ? LEVEL_TEXT[level] : 'text-ink-2')}>
      {b}
    </span>
  </span>
);
const length = (n: number, aim: string, level?: Level) =>
  `${n} characters${level === 'warn' ? `, aim for ${aim}` : ''}`;
const missing = (level: Level) => <span class={LEVEL_TEXT[level]}>Missing</span>;

export default function Overview({ ctx, snap, settings, go }: PageProps) {
  const origin = new URL(snap.url).origin;
  const robotsTxt = useAsync(() => robots(origin), [origin]);
  const overview = useAppOverview(ctx, snap.url);
  const changes = useAsync(
    () => changesSinceLastVisit(snap, ctx, settings.rememberChanges),
    [snap.url],
  );

  const idx = useMemo(
    () => indexability(snap, ctx.nav, robotsTxt.data?.parsed ?? null),
    [snap, ctx.nav, robotsTxt.data],
  );
  const content = useMemo(() => contentFindings(snap), [snap]);
  const issues = useMemo(() => {
    const tagged = (page: PageKey, list: Finding[]) =>
      list.filter((f) => f.level === 'bad' || f.level === 'warn').map((f) => ({ ...f, page }));
    return [
      ...tagged('indexability', idx.findings),
      ...tagged('content', content),
      ...tagged('images', analyseImages(snap.images).findings),
      ...tagged('social', socialFindings(snap)),
      ...(ctx.nav
        ? tagged('headers', [...redirectFindings(ctx.nav), ...headerFindings(ctx.nav)])
        : []),
    ].sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
  }, [snap, ctx.nav, idx, content]);
  const weight = useMemo(
    () => auditResources(snap.resources, snap.url).totalBytes + snap.timing.transferSize,
    [snap],
  );

  const app = appView(overview);
  const o = app.o;
  const base = cardsFrom(ctx.vitals);
  const appCards = monitoredCards(o, base);
  const cards =
    appCards ??
    (ctx.monitored && app.loading ? base.map((c) => ({ ...c, cruxLoading: true })) : base);

  const nav = ctx.nav;
  // Pages loaded before the extension started have no recorded response; their own
  // Navigation Timing still knows the status.
  const status = nav?.status || snap.status || 0;
  const reason = nav?.statusLine.replace(/^HTTP\/\S+\s*/, '') ?? '';
  const statusText = status
    ? nav?.status && /\D/.test(reason)
      ? reason
      : `${status} ${REASON[status] ?? ''}`.trim()
    : '';
  const fromPage = !nav?.status && status > 0;
  const hops = nav?.redirects ?? [];
  const level = (id: string) => content.find((f) => f.id.startsWith(id))?.level;
  const description = metaValue(snap, 'description');
  const h1s = snap.headings.filter((h) => h.level === 1);
  const directives = [...robotsDirectives(snap, nav)];
  const types = [...new Set(parseJsonLd(snap.jsonLd).items.map((i) => String(i['@type'])))];
  const r = robotsTxt.data;
  const verdict = r && r.status === 200 ? isAllowed(r.parsed, 'Googlebot', snap.url) : null;

  return (
    <Page title="Overview" aside={o && <WatchButton o={o} ctx={ctx} />}>
      <div class="-mt-2.5 flex flex-col gap-2.5">
        <p class="mono break-all text-ink-2">{snap.url}</p>
        <div class="flex flex-wrap gap-1.5">
          {status > 0 && (
            <Pill level={status >= 400 ? 'bad' : status >= 300 ? 'warn' : 'good'}>
              {statusText}
            </Pill>
          )}
          <Pill level={idx.indexable ? 'good' : 'bad'}>
            {idx.indexable ? 'Indexable' : 'Not indexable'}
          </Pill>
          {hops.length > 0 && (
            <Pill level="warn">
              {hops.length} redirect{hops.length > 1 ? 's' : ''}
            </Pill>
          )}
          {snap.lang ? <Pill>{snap.lang}</Pill> : <Pill level="warn">No lang attribute</Pill>}
          <Pill>{num(snap.wordCount)} words</Pill>
          {snap.timing.load > 0 && (
            <Pill>
              Loaded in {ms(snap.timing.load)} · {bytes(weight)}
            </Pill>
          )}
        </div>
      </div>

      <Section
        title="Core Web Vitals"
        aside={
          <a
            href="#performance"
            class="font-medium"
            onClick={(e) => {
              e.preventDefault();
              go('performance');
            }}
          >
            Performance ›
          </a>
        }
      >
        <VitalCards cards={cards} />
        {appCards || (ctx.monitored && app.loading) ? (
          <p class="text-xs text-ink-3">
            Big numbers: this load on your device. Below: CrUX, the last 90 days of real Chrome
            users.
          </p>
        ) : (
          !ctx.auth.signedIn && <CruxOffer ctx={ctx} url={snap.url} />
        )}
      </Section>

      {ctx.monitored && (o || app.loading) && <MonitoredStrip o={o} go={go} />}

      <Section title={`Needs attention · ${issues.length}`}>
        {issues.length ? (
          <Card class="divide-y divide-hairline overflow-hidden">
            {issues.map((f, i) => (
              <button
                type="button"
                key={i}
                class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover"
                onClick={() => go(f.page)}
              >
                <Mark level={f.level} />
                <span class="min-w-0 flex-grow break-words">{message(f)}</span>
                <span class="shrink-0 whitespace-nowrap text-xs text-ink-3">
                  {PAGE_LABEL[f.page]} ›
                </span>
              </button>
            ))}
          </Card>
        ) : (
          <p class="text-ink-2">Nothing needs attention on this page.</p>
        )}
      </Section>

      {changes.data && (
        <Section
          title="Changed since your last visit"
          aside={`${ago(changes.data.since)} · Stored in this browser`}
        >
          {changes.data.changes.length ? (
            <Card class="divide-y divide-hairline">
              {changes.data.changes.map((c) => (
                <div class="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-4 py-2.5" key={c.field}>
                  <span class="text-ink-2">{FIELD_LABELS[c.field] ?? c.field}</span>
                  <span class="flex min-w-0 flex-col gap-0.5 break-words">
                    <span class="text-poor-text line-through">{c.before || 'Empty'}</span>
                    <span class="text-good-text">{c.after || 'Empty'}</span>
                  </span>
                </div>
              ))}
              <div class="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-4 py-2.5">
                <span class="text-ink-2">Unchanged</span>
                <span class="text-ink-2">
                  {Object.keys(UNCHANGED)
                    .filter((k) => !changes.data!.changes.some((c) => c.field === k))
                    .map((k) => UNCHANGED[k])
                    .join(', ') || 'nothing else we track'}
                </span>
              </div>
            </Card>
          ) : (
            <p class="text-ink-2">Nothing SEO-relevant changed.</p>
          )}
        </Section>
      )}

      <Section title="Crawl">
        <KeyValues
          rows={[
            [
              'Status',
              fromPage ? (
                <span>
                  {statusText} <span class="text-ink-2">· From the page, reload to record</span>
                </span>
              ) : (
                statusText || '–'
              ),
            ],
            [
              'Redirects',
              !nav ? (
                <span class="text-ink-2">Unknown – not recorded</span>
              ) : hops.length ? (
                <span class="text-warn-text">
                  {hops.length} hop{hops.length > 1 ? 's' : ''} (
                  {hops.map((h) => h.status).join(', ')})
                </span>
              ) : (
                'None'
              ),
            ],
            [
              'robots.txt',
              robotsTxt.loading ? (
                'Checking…'
              ) : !r ? (
                'Could not be read'
              ) : robotsUnavailable(r.status) ? (
                <span class="text-poor-text">
                  HTTP {r.status}, so Google crawls nothing on this site
                </span>
              ) : !verdict ? (
                `None (HTTP ${r.status}), so everything is allowed`
              ) : verdict.allowed ? (
                'Allowed for Googlebot'
              ) : (
                <span class="text-poor-text">
                  Blocked for Googlebot by <span class="mono">Disallow: {verdict.rule!.path}</span>
                </span>
              ),
            ],
            [
              'Meta robots',
              directives.length ? (
                <span class={directives.includes('noindex') ? 'text-poor-text' : ''}>
                  {directives.join(', ')}
                </span>
              ) : (
                'Not set (index, follow)'
              ),
            ],
            [
              'Sitemaps',
              r?.parsed.sitemaps.length
                ? `${r.parsed.sitemaps.length} declared in robots.txt`
                : 'None declared in robots.txt',
            ],
          ]}
        />
      </Section>

      <Section title="Page">
        <KeyValues
          rows={[
            [
              'Title',
              snap.title ? (
                <Two
                  a={snap.title}
                  b={length(snap.title.length, '30–60', level('title.'))}
                  level={level('title.')}
                />
              ) : (
                missing('bad')
              ),
            ],
            [
              'Description',
              description ? (
                <Two
                  a={description}
                  b={length(description.length, '70–160', level('description.'))}
                  level={level('description.')}
                />
              ) : (
                missing('warn')
              ),
            ],
            [
              'Canonical',
              idx.canonical ? (
                idx.canonicalSelf ? (
                  'Self-referencing'
                ) : idx.canonicalClean ? (
                  'This page without its tracking parameters'
                ) : (
                  <span class="mono text-warn-text [overflow-wrap:anywhere]">{idx.canonical}</span>
                )
              ) : (
                missing('warn')
              ),
            ],
            [
              'H1',
              h1s.length > 1 ? (
                <Two a={h1s[0].text} b={`${h1s.length} H1 headings`} level="warn" />
              ) : (
                h1s[0]?.text || missing('bad')
              ),
            ],
            ['Structured data', types.length ? types.join(', ') : 'None'],
          ]}
        />
      </Section>

      {!ctx.auth.signedIn && <MonitorPromo ctx={ctx} />}
    </Page>
  );
}
