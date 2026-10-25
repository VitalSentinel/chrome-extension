import { useMemo } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { metaValues } from '../../lib/checks/content';
import { hreflangFindings } from '../../lib/checks/hreflang';
import {
  header,
  indexability,
  linkHeaderCanonicals,
  robotsDirectives,
} from '../../lib/checks/indexability';
import { compareRaw, type RawDiffRow } from '../../lib/checks/raw';
import { isAllowed, robotsUnavailable } from '../../lib/checks/robots';
import { num } from '../../lib/format';
import type { Level } from '../../lib/types';
import { message } from '../../i18n/findings';
import {
  Banner,
  Card,
  ErrorNote,
  Findings,
  Loading,
  Mark,
  Note,
  Page,
  Pill,
  Section,
  Table,
  cx,
} from '../../ui/kit';
import { appView, GoogleIndex, IndexedInGoogle, useAppOverview } from '../appData';
import { rawSnapshot, robots, sitemaps, useAsync, type SitemapCheck } from '../data';
import type { PageProps } from '../types';
import { ruleLines, ruleText } from './Crawlers';

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  robots: 'Meta robots',
  canonical: 'Canonical',
  h1: 'H1',
  words: 'Words',
  links: 'Links',
  jsonLd: 'JSON-LD blocks',
  hreflang: 'hreflang entries',
};

type Signal = [Level, string, ComponentChildren];

/** Mark, label and value per row, like the design's signal list. */
function Signals({ rows }: { rows: Signal[] }) {
  return (
    <Card class="divide-y divide-hairline">
      {rows.map(([level, label, value]) => (
        <div
          class="grid grid-cols-[16px_120px_minmax(0,1fr)] items-start gap-3 px-4 py-2.5"
          key={label}
        >
          <Mark level={level} />
          <span class="text-ink-2">{label}</span>
          <span class="min-w-0 break-words">{value}</span>
        </div>
      ))}
    </Card>
  );
}

const Sub = ({ children }: { children: ComponentChildren }) => (
  <span class="mono block break-all text-ink-2">{children}</span>
);
const Muted = ({ children }: { children: ComponentChildren }) => (
  <span class="text-ink-3">{children}</span>
);
const NUMERIC = new Set(['words', 'links', 'jsonLd', 'hreflang']);
const KIND: Record<string, string> = { index: 'Index', urlset: 'Sitemap' };

/** Host and path of a URL; a value that is not a URL stays whole as the path. */
function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return u.host ? { host: u.host, path: u.pathname + u.search } : { host: '', path: url };
  } catch {
    return { host: '', path: url };
  }
}
const statusLevel = (s: number): Level =>
  s >= 400 || s === 0 ? 'bad' : s >= 300 ? 'warn' : 'good';

function sitemapSignal(state: {
  data?: SitemapCheck;
  loading: boolean;
  error: string | null;
}): Signal {
  if (state.loading) return ['info', 'Sitemap', 'Checking sitemaps…'];
  if (state.error || !state.data)
    return ['info', 'Sitemap', `Could not be read${state.error ? ` (${state.error})` : ''}`];
  if (state.data.listed === null) return ['info', 'Sitemap', 'No sitemap found'];
  return state.data.listed
    ? ['good', 'Sitemap', 'Listed in the sitemap']
    : ['warn', 'Sitemap', 'Not listed in any sitemap that was read'];
}

export default function Indexability({ ctx, snap, go }: PageProps) {
  const url = snap.url;
  const origin = new URL(url).origin;
  const robotsTxt = useAsync(() => robots(origin), [origin]);
  const sitemap = useAsync(() => sitemaps(url), [url]);
  const raw = useAsync(() => rawSnapshot(url), [url]);
  const overview = useAppOverview(ctx, url);
  const app = appView(overview);
  const nav = ctx.nav;
  const parsed = robotsTxt.data?.parsed ?? null;

  const idx = useMemo(() => indexability(snap, nav, parsed), [snap, nav, parsed]);
  const directives = useMemo(() => [...robotsDirectives(snap, nav)], [snap, nav]);
  const linkCanonicals = useMemo(() => linkHeaderCanonicals(nav, url), [nav, url]);
  const googlebot = useMemo(
    () => (parsed ? isAllowed(parsed, 'Googlebot', url) : null),
    [parsed, url],
  );
  const hreflang = useMemo(() => hreflangFindings(snap), [snap]);
  const diff = useMemo(
    () => (raw.data?.snapshot ? compareRaw(raw.data.snapshot, snap) : null),
    [raw.data, snap],
  );

  const reasons = idx.findings
    .filter((f) => f.level === 'bad' || f.level === 'warn')
    .map((f) => message(f));
  const metaRobots = [...metaValues(snap, 'robots'), ...metaValues(snap, 'googlebot')];
  const xRobots = header(nav, 'x-robots-tag');

  const robotsSignal = (): Signal => {
    if (robotsTxt.loading) return ['info', 'robots.txt', 'Loading robots.txt…'];
    if (!robotsTxt.data) return ['info', 'robots.txt', 'robots.txt could not be fetched'];
    if (robotsUnavailable(robotsTxt.data.status))
      return [
        'bad',
        'robots.txt',
        `robots.txt answers HTTP ${robotsTxt.data.status} – Google crawls nothing until it can read the file`,
      ];
    if (robotsTxt.data.status !== 200)
      return [
        'good',
        'robots.txt',
        `No robots.txt (HTTP ${robotsTxt.data.status}) – everything is allowed`,
      ];
    const rule = googlebot?.rule;
    const line = rule ? ruleLines(robotsTxt.data.text, robotsTxt.data.parsed).get(rule) : undefined;
    return [
      googlebot?.allowed ? 'good' : 'bad',
      'robots.txt',
      <>
        {googlebot?.allowed ? 'Allowed for Googlebot' : 'Blocked for Googlebot'}
        <Sub>
          {rule ? `${line ? `Line ${line} · ` : ''}${ruleText(rule)}` : 'No matching rule'} ·{' '}
          <button
            type="button"
            class="text-accent-text hover:underline"
            onClick={() => go('crawlers')}
          >
            all crawlers ›
          </button>
        </Sub>
      </>,
    ];
  };

  const rows: Signal[] = [
    nav?.status
      ? [
          statusLevel(nav.status),
          'HTTP status',
          `${nav.statusLine || nav.status}${nav.redirects.length ? ` after ${nav.redirects.length} redirect${nav.redirects.length > 1 ? 's' : ''}` : ''}`,
        ]
      : snap.status
        ? [
            statusLevel(snap.status),
            'HTTP status',
            <>
              {snap.status}
              <span class="block text-ink-2">
                From the page – redirects and headers were not recorded
              </span>
            </>,
          ]
        : ['info', 'HTTP status', 'Unknown – the page loaded before the extension started'],
    [
      /noindex|none/i.test(metaRobots.join(',')) ? 'bad' : 'good',
      'Meta robots',
      metaRobots.length ? (
        <span class="mono">{metaRobots.join(', ')}</span>
      ) : (
        <Muted>Not set</Muted>
      ),
    ],
    [
      /noindex|none/i.test(xRobots.join(',')) ? 'bad' : 'good',
      'X-Robots-Tag',
      !nav ? (
        <Muted>Unknown</Muted>
      ) : xRobots.length ? (
        <span class="mono">{xRobots.join(', ')}</span>
      ) : (
        <Muted>Not set</Muted>
      ),
    ],
    [
      directives.includes('noindex') ? 'bad' : directives.includes('nofollow') ? 'warn' : 'good',
      'Directives',
      directives.length ? (
        <span class="mono">{directives.join(', ')}</span>
      ) : (
        'None (index, follow)'
      ),
    ],
    [
      !idx.canonical ? 'warn' : idx.canonicalSelf || idx.canonicalClean ? 'good' : 'warn',
      'Canonical',
      idx.canonical ? (
        <>
          {idx.canonicalSelf
            ? 'Self-referencing'
            : idx.canonicalClean
              ? 'This page without its tracking parameters'
              : 'Points to another URL'}
          <Sub>{idx.canonical}</Sub>
          {linkCanonicals.length > 0 && <Sub>Link header: {linkCanonicals.join(', ')}</Sub>}
        </>
      ) : (
        'Missing'
      ),
    ],
    robotsSignal(),
    sitemapSignal(sitemap),
  ];

  return (
    <Page title="Indexability">
      <Banner
        level={idx.indexable ? 'good' : 'bad'}
        title={
          !idx.indexable
            ? 'Google will not index this page'
            : idx.canonicalClean
              ? 'Google indexes the clean URL of this page'
              : 'Google can index this page'
        }
      >
        {reasons.length
          ? reasons.join('. ')
          : idx.canonicalClean
            ? message({ id: 'canonical.clean', params: { url: idx.canonical! } })
            : 'Status, robots directives, canonical and robots.txt all allow indexing.'}
        {ctx.monitored && <IndexedInGoogle app={app} />}
      </Banner>

      <Section title="Signals">
        <Signals rows={rows} />
      </Section>

      {ctx.monitored && <GoogleIndex app={app} />}

      <Section
        title="Sitemaps"
        aside={sitemap.data ? `${sitemap.data.sources.length} read` : undefined}
      >
        {sitemap.loading ? (
          <Loading label="Reading sitemaps…" />
        ) : sitemap.error ? (
          <ErrorNote>Sitemaps could not be read: {sitemap.error}</ErrorNote>
        ) : (
          <SitemapTable sources={sitemap.data?.sources ?? []} />
        )}
      </Section>

      <Section title={`hreflang · ${snap.hreflang.length}`}>
        <Table
          rows={snap.hreflang}
          empty="No hreflang annotations on this page."
          columns={[
            {
              label: 'Language',
              width: '100px',
              render: (h) => <span class="mono">{h.lang}</span>,
            },
            {
              label: 'URL',
              render: (h) => (
                <span class="mono block truncate" title={h.href}>
                  {h.href}
                </span>
              ),
            },
          ]}
        />
        <Findings items={hreflang} />
      </Section>

      <Section title="Raw HTML vs rendered page" aside="Raw = what a non-rendering crawler sees">
        <RawCompare state={raw} rows={diff?.rows} />
        {diff && <Findings items={diff.findings} empty="Raw HTML and the rendered page agree." />}
      </Section>
    </Page>
  );
}

function RawCompare({
  state,
  rows,
}: {
  state: { loading: boolean; error: string | null; data?: { status: number } };
  rows?: RawDiffRow[];
}) {
  if (state.loading) return <Loading label="Fetching the raw HTML…" />;
  if (state.error) return <ErrorNote>The raw HTML could not be fetched: {state.error}</ErrorNote>;
  if (!rows)
    return (
      <Note>
        The raw response is not HTML (HTTP {state.data?.status}), so there is nothing to compare.
      </Note>
    );
  const value = (v: string, r: RawDiffRow) =>
    !v ? <Muted>Not set</Muted> : NUMERIC.has(r.field) ? num(Number(v)) : v;
  const clamp = (v: string, body: ComponentChildren, c?: string) => (
    <span class={cx('line-clamp-2', c)} title={v || undefined}>
      {body}
    </span>
  );
  const rendered = (r: RawDiffRow) => {
    if (r.raw === r.rendered) return <Muted>Same</Muted>;
    const delta = Number(r.rendered) - Number(r.raw);
    return NUMERIC.has(r.field) ? (
      <>
        {num(Number(r.rendered))}{' '}
        <Muted>
          ({delta > 0 ? '+' : '–'}
          {num(Math.abs(delta))} by JS)
        </Muted>
      </>
    ) : (
      clamp(r.rendered, value(r.rendered, r))
    );
  };
  return (
    <Table
      rows={rows}
      rowLevel={(r) => (r.differs ? 'warn' : undefined)}
      columns={[
        {
          label: 'Field',
          width: '120px',
          render: (r) => <span class="text-ink-2">{FIELD_LABELS[r.field] ?? r.field}</span>,
        },
        {
          label: 'Raw HTML',
          render: (r) =>
            clamp(r.raw, value(r.raw, r), r.differs ? 'font-semibold text-warn-text' : undefined),
        },
        { label: 'Rendered', render: rendered },
      ]}
    />
  );
}

const SITEMAP_GRID = 'grid grid-cols-[minmax(0,1fr)_76px_72px_64px] items-center gap-3 px-4';

/** Sitemap files grouped by host, so each host shows once and rows keep to one line. */
function SitemapTable({ sources }: { sources: SitemapCheck['sources'] }) {
  if (!sources.length)
    return (
      <Card class="px-4 py-3.5 text-ink-2">
        No sitemap in robots.txt, /sitemap.xml or /sitemap_index.xml.
      </Card>
    );
  const hosts = new Map<string, SitemapCheck['sources']>();
  for (const s of sources) {
    const { host } = splitUrl(s.url);
    hosts.set(host, [...(hosts.get(host) ?? []), s]);
  }
  return (
    <Card class="overflow-hidden">
      <div
        class={cx(SITEMAP_GRID, 'bg-surface-inset py-2.5 text-[11.5px] font-semibold text-ink-2')}
      >
        <span>File</span>
        <span>Status</span>
        <span>Kind</span>
        <span class="text-right">URLs</span>
      </div>
      {[...hosts].map(([host, list]) => (
        <div class="border-t border-hairline" key={host}>
          {host && <div class="px-4 pb-1 pt-2.5 text-xs font-semibold text-ink-2">{host}</div>}
          {list.map((s) => (
            <div class={cx(SITEMAP_GRID, 'py-2')} key={s.url}>
              <span class="mono truncate" title={s.url}>
                {splitUrl(s.url).path}
              </span>
              <span>
                {s.kind === 'skipped' ? (
                  <Pill level="info">Skipped</Pill>
                ) : (
                  <Pill level={statusLevel(s.status)}>{s.status || 'Error'}</Pill>
                )}
              </span>
              <span class={KIND[s.kind] ? '' : 'text-ink-3'}>{KIND[s.kind] ?? '–'}</span>
              <span class="text-right tabular-nums">{s.status === 200 ? num(s.count) : '–'}</span>
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}
