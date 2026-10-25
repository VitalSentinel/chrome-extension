import { Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { auditResources } from '../../lib/checks/resources';
import { bytes, ms } from '../../lib/format';
import { pagespeedWebUrl } from '../../lib/psi';
import type { ResourceInfo } from '../../lib/types';
import { sameSite } from '../../lib/url';
import { formatMetric } from '../../lib/vitals';
import { message } from '../../i18n/findings';
import {
  Card,
  KeyValues,
  LinkButton,
  Page,
  Pill,
  Section,
  Stats,
  Switch,
  Table,
} from '../../ui/kit';
import { overlay, overlayShown } from '../data';
import { appView, CruxHistory, useAppOverview } from '../appData';
import { CruxOffer } from '../Promo';
import type { PageProps } from '../types';
import { cardsFrom, MetricTiles } from '../Vitals';

/** Same-site files by path, others by host and path. */
const short = (url: string, page: string) => {
  try {
    const u = new URL(url);
    return sameSite(url, page) ? u.pathname : u.hostname + u.pathname;
  } catch {
    return url;
  }
};
const size = (r: ResourceInfo) => r.transferSize || r.encodedSize;
const JS = /\.m?js(\?|$)/i;
const IMG = /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i;

/** Selectors break before `.`, `>`, `#` or `[` and after a space, never mid-name. */
function Code({ text }: { text: string }) {
  const parts = text.split(/(?=[.>#[])|(?<=[,\s])/);
  return (
    <span class="mono break-words">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {p}
        </Fragment>
      ))}
    </span>
  );
}

function Mono({ text }: { text: string }) {
  return (
    <span class="mono block truncate" title={text}>
      {text}
    </span>
  );
}

export default function Performance({ ctx, snap }: PageProps) {
  const overview = useAppOverview(ctx, snap.url);
  const [showOverlay, setShowOverlay] = useState(false);
  const [drawn, setDrawn] = useState<{ lcp: boolean; shifts: number } | null>(null);
  const [overlayFailed, setOverlayFailed] = useState(false);
  // The overlay stays on the page after the popup closes; the switch shows it on reopening.
  useEffect(() => {
    let live = true;
    void overlayShown(ctx.tabId).then((on) => live && on && setShowOverlay(true));
    return () => {
      live = false;
    };
  }, [ctx.tabId]);
  const audit = useMemo(() => auditResources(snap.resources, snap.url), [snap]);
  const vitals = ctx.vitals;
  const lcp = vitals?.metrics.LCP;
  const shifts = [...(vitals?.shifts ?? [])].sort((a, b) => b.value - a.value);
  const t = snap.timing;
  // Navigation timing stands in for TTFB and FCP until the web-vitals report arrives.
  const tiles = cardsFrom(vitals, ['TTFB', 'LCP', 'FCP', 'CLS', 'INP']).map((c) => ({
    ...c,
    device:
      c.device ?? ((c.metric === 'TTFB' ? t.ttfb : c.metric === 'FCP' ? t.fcp : 0) || undefined),
  }));

  const flagged = useMemo(() => {
    const blocking = new Set(audit.renderBlocking);
    const raw = new Set(audit.uncompressed);
    return [...new Set([...blocking, ...raw])].map((r) => ({
      r,
      issue:
        blocking.has(r) && raw.has(r)
          ? 'Blocking, not compressed'
          : blocking.has(r)
            ? 'Render-blocking'
            : 'Not compressed',
    }));
  }, [audit]);
  const weight = useMemo(() => {
    // Cross-origin files without Timing-Allow-Origin report no size; none known shows a dash.
    const sum = (test: (r: ResourceInfo) => boolean) => {
      const n = snap.resources.filter(test).reduce((total, r) => total + size(r), 0);
      return n || !snap.resources.some(test) ? bytes(n) : '–';
    };
    return {
      js: sum((r) => r.type === 'script' || JS.test(r.url)),
      img: sum((r) => r.type === 'img' || IMG.test(r.url)),
    };
  }, [snap]);
  const topHosts = audit.thirdParty.filter((h) => h.bytes).slice(0, 5);
  const otherHosts = audit.thirdParty.length - topHosts.length;
  const otherBytes = audit.thirdPartyBytes - topHosts.reduce((n, h) => n + h.bytes, 0);

  const toggleOverlay = async (on: boolean) => {
    setShowOverlay(on);
    setOverlayFailed(false);
    const result = await overlay(ctx.tabId, on).catch(() => undefined);
    setDrawn(result ?? null);
    if (on && !result) {
      setShowOverlay(false);
      setOverlayFailed(true);
    }
  };
  const overlayNote = overlayFailed
    ? 'Could not draw on this page. Reload it and try again.'
    : showOverlay && drawn
      ? `${drawn.lcp ? 'LCP element outlined in purple' : 'LCP element not found on screen'} · ${drawn.shifts ? `${drawn.shifts} shifted element${drawn.shifts === 1 ? '' : 's'} in red` : 'No layout shifts to show'}`
      : 'Outlines the LCP element in purple and elements that shifted in red, until you reload.';

  return (
    <Page
      title="Performance"
      aside={<LinkButton href={pagespeedWebUrl(snap.url)}>Run on PageSpeed Insights ↗</LinkButton>}
    >
      <Section title="Measured on this device" aside="This page load · Updates live">
        <div class="flex flex-col gap-3.5">
          <MetricTiles cards={tiles.slice(0, 3)} />
          <MetricTiles cards={tiles.slice(3)} />
        </div>
        <KeyValues
          rows={[
            [
              'LCP element',
              lcp?.target ? (
                <span class="flex flex-col gap-0.5">
                  <Code text={lcp.target} />
                  <span class="text-xs text-ink-2">
                    Painted at {formatMetric('LCP', lcp.value)}
                  </span>
                </span>
              ) : (
                '–'
              ),
            ],
            [
              'Largest shift',
              shifts[0] ? (
                <span class="flex flex-col gap-0.5">
                  <Code text={shifts[0].selectors.join(', ') || 'removed from the page'} />
                  <span class="text-xs text-ink-2">
                    {shifts[0].value.toFixed(3)} of CLS{' '}
                    {formatMetric('CLS', vitals!.metrics.CLS?.value ?? 0)}
                  </span>
                </span>
              ) : (
                'No layout shifts'
              ),
            ],
            [
              'Page load',
              `DOM ready ${t.domContentLoaded ? ms(t.domContentLoaded) : '–'} · Fully loaded ${t.load ? ms(t.load) : '–'}`,
            ],
          ]}
        />
      </Section>

      <Card class="flex items-center gap-3.5 border-accent-tint bg-accent-tint/50 px-4 py-3.5">
        <label class="flex flex-grow flex-col gap-0.5" for="overlay">
          <span class="font-semibold">Show on page</span>
          <span class="text-xs text-ink-2">{overlayNote}</span>
        </label>
        <Switch
          checked={showOverlay}
          onChange={toggleOverlay}
          label="Outline the LCP element and layout shifts on the page"
        />
      </Card>

      {shifts.length > 1 && (
        <Section title={`Layout shifts · ${shifts.length}`}>
          <Table
            columns={[
              { label: 'Shift', width: '64px', render: (s) => s.value.toFixed(3) },
              {
                label: 'Elements that moved',
                render: (s) => <Code text={s.selectors.join(', ') || 'removed from the page'} />,
              },
            ]}
            rows={shifts}
          />
        </Section>
      )}

      {ctx.monitored ? (
        <CruxHistory app={appView(overview)} />
      ) : (
        !ctx.auth.signedIn && (
          <Section title="CrUX data · 28 days">
            <CruxOffer ctx={ctx} url={snap.url} />
          </Section>
        )
      )}

      <Section title={`Resources · ${snap.resources.length} requests`} aside="From this page load">
        {audit.findings.length > 0 && (
          <div class="flex flex-wrap gap-1.5">
            {audit.findings.map((f) => (
              <Pill level={f.id === 'res.renderBlocking' ? 'bad' : 'warn'} key={f.id}>
                {message(f)}
              </Pill>
            ))}
          </div>
        )}
        <Table
          columns={[
            { label: 'File', render: ({ r }) => <Mono text={short(r.url, snap.url)} /> },
            { label: 'Issue', width: '170px', render: ({ issue }) => issue },
            {
              label: 'Size',
              width: '64px',
              render: ({ r }) => (
                <span class="whitespace-nowrap">
                  {size(r) || r.decodedSize ? bytes(size(r) || r.decodedSize) : '–'}
                </span>
              ),
            },
            {
              label: 'Host',
              width: '84px',
              render: ({ r }) => (sameSite(r.url, snap.url) ? 'first-party' : 'third-party'),
            },
          ]}
          rows={flagged}
          empty="No render-blocking or uncompressed resources found."
        />
      </Section>

      {audit.thirdParty.length > 0 && (
        <Section
          title={`Third-party weight · ${audit.thirdParty.length} host${audit.thirdParty.length > 1 ? 's' : ''}`}
          aside={`${bytes(audit.thirdPartyBytes)} in total`}
        >
          <Card class="divide-y divide-hairline">
            {topHosts.map((h) => (
              <div
                key={h.host}
                class="grid grid-cols-[minmax(0,1fr)_120px_64px] items-center gap-4 px-4 py-2.5"
              >
                <span class="flex min-w-0 flex-col">
                  <span class="mono truncate" title={h.host}>
                    {h.host}
                  </span>
                  <span class="text-2xs text-ink-3">
                    {h.count} request{h.count > 1 ? 's' : ''}
                  </span>
                </span>
                <span class="h-1.5 overflow-hidden rounded-pill bg-track" aria-hidden="true">
                  <span
                    class="block h-full rounded-pill bg-accent"
                    style={{ width: `${Math.max(3, (h.bytes / topHosts[0].bytes) * 100)}%` }}
                  />
                </span>
                <span class="text-right font-semibold tabular-nums">{bytes(h.bytes)}</span>
              </div>
            ))}
            {otherHosts > 0 && (
              <div class="flex items-center justify-between gap-4 px-4 py-2.5 text-ink-2">
                <span>
                  {otherHosts} more host{otherHosts > 1 ? 's' : ''}
                </span>
                {otherBytes > 0 && <span class="tabular-nums">{bytes(otherBytes)}</span>}
              </div>
            )}
          </Card>
        </Section>
      )}

      <Section title="Page weight">
        <Stats
          items={[
            { label: 'Requests', value: snap.resources.length },
            { label: 'Transferred', value: bytes(audit.totalBytes + t.transferSize) },
            { label: 'JavaScript', value: weight.js },
            { label: 'Images', value: weight.img },
            {
              label: 'Third parties',
              value: audit.thirdParty.length,
            },
          ]}
        />
      </Section>
    </Page>
  );
}
