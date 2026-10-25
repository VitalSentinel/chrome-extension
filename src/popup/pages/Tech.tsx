import { useMemo } from 'preact/hooks';
import { detectTech, type DetectedTech, type TechCategory } from '../../lib/checks/tech';
import {
  scanTracking,
  type ConsentMode,
  type CookieRow,
  requestsFrom,
} from '../../lib/checks/tracking';
import { num, capital } from '../../lib/format';
import { message } from '../../i18n/findings';
import {
  Banner,
  Card,
  Chip,
  ErrorNote,
  Findings,
  Loading,
  Page,
  Section,
  Table,
  cx,
} from '../../ui/kit';
import { cookies, probe, useAsync } from '../data';
import type { PageProps } from '../types';

const CATEGORIES: [TechCategory, string][] = [
  ['cms', 'CMS'],
  ['ecommerce', 'E-commerce'],
  ['framework', 'Frameworks'],
  ['library', 'Libraries'],
  ['server', 'Server and CDN'],
  ['tags', 'Tag managers'],
  ['analytics', 'Analytics'],
  ['ads', 'Advertising'],
  ['cmp', 'Consent'],
  ['fonts', 'Fonts'],
];

const CONSENT_KEYS = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];
const SAME_SITE: Record<string, string> = {
  no_restriction: 'SameSite=None',
  lax: 'SameSite=Lax',
  strict: 'SameSite=Strict',
};

function expiresIn(c: CookieRow, now = Date.now()): string {
  if (c.session || c.expires === null) return 'Session';
  const days = (c.expires * 1000 - now) / 86_400_000;
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

const flags = (c: CookieRow) =>
  [c.secure && 'Secure', c.httpOnly && 'HttpOnly', SAME_SITE[c.sameSite]]
    .filter(Boolean)
    .join(', ') || '–';

function TechRows({ tech }: { tech: DetectedTech[] }) {
  const groups = CATEGORIES.map(
    ([key, label]) => [label, tech.filter((t) => t.category === key)] as const,
  ).filter(([, list]) => list.length);
  if (!groups.length)
    return <Card class="px-4 py-3.5 text-ink-2">No known technologies detected.</Card>;
  return (
    <Card class="divide-y divide-hairline">
      {groups.map(([label, list]) => (
        <div
          class="grid grid-cols-[130px_minmax(0,1fr)] items-baseline gap-3 px-4 py-2.5"
          key={label}
        >
          <span class="text-ink-2">{label}</span>
          <span class="flex flex-wrap items-center gap-2">
            {list.map((t) => (
              <Chip key={t.name}>
                <span class="whitespace-nowrap">{t.name}</span>
                {t.version && <span class="mono whitespace-nowrap text-ink-2">{t.version}</span>}
              </Chip>
            ))}
          </span>
        </div>
      ))}
    </Card>
  );
}

/** A consent key that may wrap only after an underscore, never mid-word. */
const breakable = (key: string) =>
  key.split('_').flatMap((part, i) => (i ? [<wbr key={i} />, `_${part}`] : [part]));

function ConsentGrid({ mode }: { mode: ConsentMode }) {
  return (
    <Card class="grid grid-cols-4 grid-rows-[auto_auto_auto] divide-x divide-hairline">
      {CONSENT_KEYS.map((key) => {
        const v = mode.defaults[key];
        const update = mode.updates[key];
        return (
          // Subgrid rows keep key, value and update lines level across the four cells.
          <div class="row-span-3 grid min-w-0 grid-rows-subgrid gap-0.5 px-3 py-2.5" key={key}>
            <span class="text-xs text-ink-2">{breakable(key)}</span>
            <span
              class={cx(
                'font-bold',
                !v ? 'text-warn-text' : v === 'denied' ? 'text-good-text' : 'text-ink',
              )}
            >
              {v ? capital(v) : 'Not set'}
            </span>
            <span class="text-xs text-ink-3">
              {update ? (
                <>
                  Update: <span class="font-semibold text-ink-2">{capital(update)}</span>
                </>
              ) : (
                'No update'
              )}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export default function Tech({ ctx, snap }: PageProps) {
  const state = useAsync(
    () => Promise.all([cookies(snap.url, ctx.tabId), probe(ctx.tabId)]),
    [snap.url, ctx.tabId],
  );

  const result = useMemo(() => {
    if (!state.data) return null;
    const [jar, pr] = state.data;
    const tech = detectTech({
      snapshot: snap,
      nav: ctx.nav,
      cookies: jar.map((c) => c.name),
      globals: pr.globals,
    });
    // With no requests and no CMP, scanTracking only tests the jar for a stored consent cookie.
    const consentCookie = scanTracking([], jar, null, false).consentStored;
    const cmpPresent = consentCookie || tech.some((t) => t.category === 'cmp');
    return {
      jar,
      tech,
      scan: scanTracking(requestsFrom(snap.resources), jar, pr.consentMode, cmpPresent),
    };
  }, [state.data, snap, ctx.nav]);

  if (state.loading)
    return (
      <Page title="Tech and tracking">
        <Loading label="Reading cookies and page scripts…" rows={5} />
      </Page>
    );
  if (state.error || !result)
    return (
      <Page title="Tech and tracking">
        <ErrorNote>The page could not be scanned: {state.error}</ErrorNote>
      </Page>
    );

  const { jar, tech, scan } = result;
  const before = scan.findings.find((f) => f.id === 'track.beforeConsent');
  // With a banner open and no stored choice, analytics and marketing cookies came before consent.
  const early = (c: CookieRow) =>
    !!scan.beforeConsent && (c.purpose === 'analytics' || c.purpose === 'marketing');

  return (
    <Page title="Tech and tracking">
      <Section
        title={`Tech stack · ${tech.length} detected`}
        aside="From headers, HTML, scripts and cookies"
      >
        <TechRows tech={tech} />
      </Section>

      {before && (
        <Banner level="bad" title={message(before)}>
          A consent banner is on the page but no choice is stored yet, so these loaded before the
          visitor agreed.
        </Banner>
      )}

      <Section
        title={`Trackers · ${scan.trackers.length}`}
        aside="Requests since the page started loading"
      >
        <Table
          rows={scan.trackers}
          empty="No known tracker requests."
          columns={[
            { label: 'Vendor', render: (t) => <span class="font-medium">{t.vendor}</span> },
            {
              label: 'Purpose',
              width: '110px',
              render: (t) => <span class="capitalize">{t.purpose}</span>,
            },
            { label: 'Requests', width: '70px', render: (t) => num(t.requests) },
          ]}
        />
        <Findings items={scan.findings.filter((f) => f !== before)} />
      </Section>

      <Section title="Consent Mode v2">
        {scan.consentMode ? (
          <ConsentGrid mode={scan.consentMode} />
        ) : (
          <Card class="px-4 py-3.5 text-ink-2">
            No Consent Mode commands found in the dataLayer.
          </Card>
        )}
      </Section>

      <Section title={`Cookies · ${jar.length}`}>
        <Table
          rows={jar}
          empty="No cookies for this URL."
          rowLevel={(c) => (early(c) ? 'bad' : undefined)}
          columns={[
            {
              label: 'Name · Domain',
              render: (c) => (
                <>
                  <span class="mono block break-all font-bold">{c.name}</span>
                  <span class="block break-all text-xs text-ink-2">{c.domain}</span>
                </>
              ),
            },
            {
              label: 'Purpose',
              width: '130px',
              render: (c) =>
                early(c) ? (
                  <span class="font-semibold text-poor-text">
                    Before consent · <span class="capitalize">{c.purpose}</span>
                  </span>
                ) : (
                  <span class={cx('capitalize', c.purpose === 'unknown' && 'text-ink-3')}>
                    {c.purpose}
                  </span>
                ),
            },
            {
              label: 'Flags',
              width: '130px',
              render: (c) => <span class="text-xs">{flags(c)}</span>,
            },
            {
              label: 'Expires',
              width: '76px',
              render: (c) => <span class="text-xs">{expiresIn(c)}</span>,
            },
          ]}
        />
      </Section>
    </Page>
  );
}
