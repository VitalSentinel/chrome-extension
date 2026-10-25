import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { reloadTab, track } from '../data';
import { cachingFindings, securityHeaders } from '../../lib/checks/headers';
import { header } from '../../lib/checks/indexability';
import { redirectFindings } from '../../lib/checks/redirects';
import type { Level, NavRecord } from '../../lib/types';
import { message } from '../../i18n/findings';
import {
  Banner,
  Button,
  Card,
  Findings,
  LEVEL_TEXT,
  Mark,
  Page,
  Pill,
  Section,
  cx,
} from '../../ui/kit';
import type { PageProps } from '../types';

const hopLevel = (status: number): Level =>
  status >= 400
    ? 'bad'
    : status === 302 || status === 307
      ? 'warn'
      : status >= 300
        ? 'info'
        : 'good';

const ENCODING: Record<string, string> = { br: 'Brotli', gzip: 'gzip', zstd: 'Zstandard' };
const TILE: Record<Level, string> = {
  good: 'border-good/30 bg-good-tint text-good-text',
  warn: 'border-warn/30 bg-warn-tint text-warn-text',
  bad: 'border-poor/30 bg-poor-tint text-poor-text',
  info: 'border-border bg-surface-inset text-ink',
};

function NotRecorded({
  tabId,
  status,
  serviceWorker,
  reload,
}: {
  tabId: number;
  status: number;
  serviceWorker: boolean;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const reported = status > 0 && `The page reports HTTP ${status} itself. `;
  // Its service worker answers a reload too, so reloading cannot record anything.
  if (serviceWorker)
    return (
      <Page title="HTTP headers">
        <Banner level="info" title="Served by a service worker">
          {reported}A service worker answered this page, so the browser shows no network response –
          no headers or redirects to record.
        </Banner>
      </Page>
    );
  // Waits for the tab to finish loading, so the worker has recorded the new response before
  // the popup asks for it again.
  const run = async () => {
    setBusy(true);
    await reloadTab(tabId);
    reload();
    setBusy(false);
  };
  return (
    <Page title="HTTP headers">
      <Banner level="info" title="No response recorded for this page">
        {reported}
        The page was loaded before the extension started, so its redirects and headers were not
        seen. Reload the page to record them.
      </Banner>
      <div>
        <Button variant="primary" disabled={busy} onClick={run}>
          {busy ? 'Reloading…' : 'Reload page'}
        </Button>
      </div>
    </Page>
  );
}

function Fact({ label, value, level }: { label: string; value: string; level?: Level }) {
  return (
    // A subgrid row pair, so label and value lines stay level with the card beside it.
    <Card class="row-span-2 grid min-w-0 grid-rows-subgrid gap-0.5 px-4 py-2.5">
      <span class="text-xs text-ink-2">{label}</span>
      <span class={cx('break-words font-bold', level && LEVEL_TEXT[level])}>{value}</span>
    </Card>
  );
}

/** Status tile and the four facts beside it: security, transport, caching, compression. */
function Summary({ nav, passed, total }: { nav: NavRecord; passed: number; total: number }) {
  const protocol = /^HTTP\/[\d.]+/i.exec(nav.statusLine)?.[0];
  const reason = nav.statusLine.replace(/^HTTP\/[\d.]+\s+\d+\s*/i, '');
  const https = nav.url.startsWith('https:');
  const cc = header(nav, 'cache-control')[0];
  const enc = header(nav, 'content-encoding')[0];
  const level = hopLevel(nav.status);
  return (
    <section class="flex gap-4">
      <div
        class={cx(
          'flex w-[120px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-card border py-3',
          TILE[level],
        )}
      >
        <span class="font-display text-[40px] font-bold leading-none">{nav.status}</span>
        <span class="text-xs font-semibold">{reason || protocol || 'HTTP'}</span>
      </div>
      <div class="grid flex-grow grid-cols-2 gap-2.5">
        <Fact
          label="Security"
          value={`${passed} of ${total} headers`}
          level={passed === total ? 'good' : passed >= total / 2 ? 'warn' : 'bad'}
        />
        <Fact
          label="Transport"
          value={[protocol, https ? 'HTTPS' : 'Plain HTTP'].filter(Boolean).join(' · ')}
          level={https ? 'good' : 'bad'}
        />
        <Fact label="Caching" value={cc ?? 'No Cache-Control'} level={cc ? 'good' : undefined} />
        <Fact
          label="Compression"
          value={enc ? (ENCODING[enc] ?? enc) : 'None'}
          level={enc ? 'good' : 'warn'}
        />
      </div>
    </section>
  );
}

function RedirectChain({ nav }: { nav: NavRecord }) {
  const hops = [
    ...nav.redirects.map((h) => ({ url: h.url, status: h.status })),
    { url: nav.url, status: nav.status },
  ];
  return (
    <Card class="divide-y divide-hairline">
      {hops.map((h, i) => (
        <div class="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5" key={i}>
          <Pill level={hopLevel(h.status)}>{h.status}</Pill>
          <span class={cx('mono break-all', i < hops.length - 1 && 'text-ink-2')}>{h.url}</span>
        </div>
      ))}
    </Card>
  );
}

const ROW_TINT: Partial<Record<Level, string>> = { warn: 'bg-warn-tint', bad: 'bg-poor-tint' };

/** Long values with `;`-separated parts (CSP, Permissions-Policy) get one part per line. */
function HeaderValue({ value }: { value: string }) {
  const parts = value.length > 80 ? value.split(/;\s*/).filter(Boolean) : [value];
  return (
    <dd class="m-0 min-w-0 [overflow-wrap:anywhere]">
      {parts.map((p, i) => (
        <span class="block" key={i}>
          {p}
          {i < parts.length - 1 && ';'}
        </span>
      ))}
    </dd>
  );
}

function Recorded({ nav }: { nav: NavRecord }) {
  const [copied, setCopied] = useState(false);
  const security = useMemo(() => securityHeaders(nav), [nav]);
  const caching = useMemo(() => cachingFindings(nav), [nav]);
  const redirects = useMemo(() => redirectFindings(nav), [nav]);
  const passed = security.filter((h) => h.level === 'good').length;
  const hops = nav.redirects.length;

  const copy = async () => {
    await navigator.clipboard.writeText(nav.headers.map(([k, v]) => `${k}: ${v}`).join('\n'));
    track('copy.headers');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const value = (v: string | null, c?: string): ComponentChildren =>
    v && (
      <span class={cx('mono line-clamp-2 text-ink-2 [overflow-wrap:anywhere]', c)} title={v}>
        {v}
      </span>
    );

  return (
    <Page
      title="HTTP headers"
      aside={
        <Button onClick={copy} disabled={!nav.headers.length}>
          {copied ? 'Copied' : 'Copy headers'}
        </Button>
      }
    >
      <Summary nav={nav} passed={passed} total={security.length} />

      <Section
        title={`Redirect chain · ${hops} ${hops === 1 ? 'hop' : 'hops'}`}
        aside={hops ? undefined : 'No server redirects – the URL answered directly.'}
      >
        <RedirectChain nav={nav} />
        <Findings items={redirects} />
      </Section>

      <Section title="Security headers" aside={`${passed} of ${security.length} set`}>
        <Card class="divide-y divide-hairline overflow-hidden">
          {security.map((h) => (
            <div
              class={cx(
                'grid grid-cols-[16px_200px_minmax(0,1fr)] items-start gap-3 px-4 py-2.5',
                ROW_TINT[h.level],
              )}
              key={h.name}
            >
              <Mark level={h.level} />
              <span class="font-medium">{h.name}</span>
              <span class="flex min-w-0 flex-col gap-0.5">
                {h.level === 'good' ? (
                  (value(h.value, 'text-ink') ?? message(h))
                ) : (
                  <>
                    <span class={h.level === 'info' ? 'text-ink-2' : LEVEL_TEXT[h.level]}>
                      {message(h)}
                    </span>
                    {value(h.value)}
                  </>
                )}
              </span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Caching and compression">
        <Findings items={caching} />
      </Section>

      <Section
        title={`Response headers · ${nav.headers.length}`}
        aside={`final URL · ${nav.status}`}
      >
        {nav.headers.length ? (
          <dl class="mono m-0 flex flex-col gap-1 rounded-card border border-border bg-surface-inset px-4 py-3 leading-relaxed">
            {nav.headers.map(([k, v], i) => (
              <div class="grid grid-cols-[200px_minmax(0,1fr)] gap-3" key={i}>
                <dt class="break-all text-accent-text">{k}</dt>
                <HeaderValue value={v} />
              </div>
            ))}
          </dl>
        ) : (
          <Card class="px-4 py-3.5 text-ink-2">No response headers were recorded.</Card>
        )}
      </Section>
    </Page>
  );
}

export default function Headers({ ctx, snap, reload }: PageProps) {
  // A record without a status is a navigation still in flight.
  return ctx.nav?.status ? (
    <Recorded nav={ctx.nav} />
  ) : (
    <NotRecorded
      tabId={ctx.tabId}
      status={snap.status ?? 0}
      serviceWorker={!!snap.serviceWorker}
      reload={reload}
    />
  );
}
