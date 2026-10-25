import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { addDomainUrl } from '../lib/config';
import { send, type TabContext } from '../lib/messages';
import { track } from './data';
import { ErrorNote, LinkButton, cx } from '../ui/kit';
import { pagespeedWebUrl } from '../lib/psi';

// What the VitalSentinel tab and the report pages show before a site is monitored. Every
// offer leads with the free plan (one domain, every module included).

const hostOf = (ctx: TabContext) => new URL(ctx.url).hostname.replace(/^www\./, '');

// The purple hero. The accent tokens it uses keep their light values in dark mode, so white
// text on it, and accent-press text on white, stay above 4.5:1 in both schemes.
const HERO =
  'relative overflow-hidden rounded-card bg-gradient-to-br from-accent-press to-accent-hover text-accent-on';
const BIG =
  'inline-flex shrink-0 items-center rounded-pill font-semibold no-underline transition-colors hover:no-underline focus-visible:outline-accent-on';
export const ON_HERO_PRIMARY = `${BIG} bg-accent-on text-accent-press shadow-sm hover:bg-accent-on/90`;
export const ON_HERO_SECONDARY = `${BIG} border border-accent-on/40 bg-accent-on/10 text-accent-on hover:bg-accent-on/20 disabled:opacity-60`;

/** A 24 px line icon, decorative. */
function Icon({ d, class: c }: { d: string; class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={c}
    >
      <path d={d} />
    </svg>
  );
}

/** The VitalSentinel mark, inverted for the purple hero. */
function LogoMark({ class: c }: { class: string }) {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true" class={c}>
      <circle cx="28" cy="28" r="28" class="fill-accent-on" />
      <g class="fill-accent-press">
        <rect x="15" y="34" width="26" height="6" rx="3" />
        <rect x="15" y="25" width="19" height="6" rx="3" />
        <rect x="15" y="16" width="12" height="6" rx="3" />
        <circle cx="38" cy="19" r="3" />
      </g>
    </svg>
  );
}

/** Sentinel rings and a glow in the hero's top-right corner. */
function Glow() {
  return (
    <>
      <div class="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent opacity-70 blur-3xl" />
      <svg
        viewBox="0 0 220 220"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
        class="pointer-events-none absolute right-0 top-0 h-[220px] w-[220px] text-accent-on/15"
      >
        <circle cx="220" cy="0" r="70" />
        <circle cx="220" cy="0" r="125" />
        <circle cx="220" cy="0" r="180" />
      </svg>
    </>
  );
}

const CHECK = 'M5 12.5l4.5 4.5L19 7';

/** One-row offer at the foot of a report page. */
export function MonitorPromo({
  ctx,
  title,
  text,
}: {
  ctx: TabContext;
  title?: string;
  text?: string;
}) {
  const host = hostOf(ctx);
  const heading = title ?? `Monitor ${host} – free for one domain`;
  return (
    <div class={cx(HERO, 'flex items-center gap-3.5 px-4 py-3.5')}>
      <Glow />
      <LogoMark class="relative h-8 w-8 shrink-0" />
      <div class="relative flex min-w-0 flex-grow flex-col gap-0.5">
        <span class="truncate font-display text-[15px] font-bold" title={heading}>
          {heading}
        </span>
        <span class="text-xs text-accent-on/90">
          {text ?? 'Real-user Core Web Vitals, indexing and SEO changes.'}
        </span>
      </div>
      <a
        href={addDomainUrl(host)}
        target="_blank"
        rel="noreferrer"
        class={cx(ON_HERO_PRIMARY, 'relative h-8 px-4 text-xs')}
        onClick={() => track('promo.click')}
      >
        Start monitoring
      </a>
    </div>
  );
}

/**
 * Where CrUX data would be for a site that is not monitored: the free plan brings it, and
 * PageSpeed Insights runs a test of this page on Google's site.
 */
export function CruxOffer({ ctx, url }: { ctx: TabContext; url: string }) {
  const host = hostOf(ctx);
  return (
    <div class={cx(HERO, 'flex items-center gap-3.5 px-4 py-3.5')}>
      <Glow />
      <LogoMark class="relative h-8 w-8 shrink-0" />
      <div class="relative flex min-w-0 flex-grow flex-col gap-0.5">
        <span class="font-display text-[15px] font-bold">Free CrUX data for {host}</span>
        <span class="text-xs text-accent-on/90">
          Sign in and verify the site to see the 28-day data Google ranks on.
        </span>
      </div>
      <div class="relative flex shrink-0 flex-col items-stretch gap-1.5">
        <a
          href={addDomainUrl(host)}
          target="_blank"
          rel="noreferrer"
          class={cx(ON_HERO_PRIMARY, 'h-8 justify-center px-4 text-xs')}
          onClick={() => track('promo.click')}
        >
          Get CrUX free
        </a>
        <a
          href={pagespeedWebUrl(url)}
          target="_blank"
          rel="noreferrer"
          class={cx(ON_HERO_SECONDARY, 'h-8 justify-center px-3.5 text-xs')}
        >
          Test on PageSpeed Insights ↗
        </a>
      </div>
    </div>
  );
}

// Every module on vitalsentinel.com, in the app sidebar's order and the site's own
// words. The free plan includes all of them, with lower limits. [name, value, icon path]; the
// icons are the app sidebar's Lucide icons, flattened to one path each (ISC, Copyright (c) 2026
// Lucide Icons and Contributors; search and radio MIT, Copyright (c) 2013-present Cole Bemis –
// full notices in LUCIDE-LICENSE).
const MODULES: [string, string, string][] = [
  [
    'Site health monitoring',
    'A technical SEO crawl that never stops',
    'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27',
  ],
  [
    'Page monitoring',
    'SEO changes on your key pages, caught',
    'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  ],
  [
    'Google Search Console',
    'Search performance, unified',
    'm21 21-4.34-4.34M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
  ],
  [
    'Indexing monitoring',
    'Know before pages fall out of Google',
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5M9 14.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M13.3 16.3 15 18',
  ],
  [
    'Web Analytics',
    'Privacy-first, cookie-free by default',
    'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3',
  ],
  [
    'Server log monitoring',
    'What Googlebot and AI crawlers request',
    'M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
  ],
  [
    'Sitemap monitoring',
    'Every URL added or removed, tracked',
    'M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1zM3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1zM10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1zM5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8',
  ],
  [
    'Robots.txt monitoring',
    'Every change, flagged fast',
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5M10 12.5 8 15l2 2.5m14 12.5 2 2.5-2 2.5',
  ],
  [
    'Uptime monitoring',
    '24/7 availability and SSL checks',
    'M16.247 7.761a6 6 0 0 1 0 8.478M19.075 4.933a10 10 0 0 1 0 14.134M4.925 19.067a10 10 0 0 1 0-14.134M7.753 16.239a6 6 0 0 1 0-8.478M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  ],
  [
    'RUM monitoring',
    'Real users, real Core Web Vitals',
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
  ],
  ['CrUX monitoring', 'The field data Google ranks on', 'm12 14 4-4M3.34 19a10 10 0 1 1 17.32 0'],
  [
    'Synthetic monitoring',
    'Scheduled Lighthouse audits',
    'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2M6.453 15h11.094M8.5 2h7',
  ],
];

/** A module's sidebar icon on its tinted square, by the module's name above. */
export function ModuleIcon({ name }: { name: string }) {
  const d = MODULES.find(([n]) => n === name)?.[2];
  return d ? (
    <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent-tint text-accent-text">
      <Icon d={d} class="h-4 w-4" />
    </span>
  ) : null;
}

const OFFER = ['Every module included', 'No credit card', 'Live in under 5 minutes'];

function Pitch({ children }: { children: ComponentChildren }) {
  return <div class="flex flex-col gap-[21px] px-7 pb-7 pt-[21px]">{children}</div>;
}

export function Hero({
  title,
  text,
  children,
  heading: H = 'h1',
}: {
  title: ComponentChildren;
  text: string;
  children: ComponentChildren;
  heading?: 'h1' | 'h2'; // h2 inside a page that has its own title
}) {
  return (
    <div class={cx(HERO, 'px-6 py-6 shadow-sm')}>
      <Glow />
      <div class="relative flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <LogoMark class="h-8 w-8 shrink-0" />
          <span class="rounded-pill bg-accent-on/15 px-2.5 py-0.5 text-xs font-semibold">
            Free plan · 1 domain
          </span>
        </div>
        <div class="flex flex-col gap-2">
          <H class="break-words font-display text-[25px] font-bold leading-[1.15]">{title}</H>
          <p class="max-w-[470px] text-[14px] leading-normal text-accent-on/90">{text}</p>
        </div>
        <ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-semibold" aria-label="Free plan">
          {OFFER.map((o) => (
            <li class="flex items-center gap-1.5" key={o}>
              <span class="flex h-4 w-4 items-center justify-center rounded-full bg-accent-on/20">
                <Icon d={CHECK} class="h-2.5 w-2.5" />
              </span>
              {o}
            </li>
          ))}
        </ul>
        <div class="flex flex-wrap items-center gap-2.5 pt-1">{children}</div>
      </div>
    </div>
  );
}

function Modules() {
  return (
    <section class="flex flex-col gap-3" aria-labelledby="vs-modules">
      <div class="flex items-baseline gap-2.5">
        <h2 id="vs-modules" class="flex-grow font-display text-[16px] font-bold">
          Everything VitalSentinel monitors
        </h2>
        <span class="text-xs text-ink-2">12 modules · All in the free plan</span>
      </div>
      <ul class="grid grid-cols-3 gap-2.5">
        {MODULES.map(([name, what, icon]) => (
          <li
            class="flex flex-col gap-2 rounded-tile border border-border bg-surface p-3"
            key={name}
          >
            <span class="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent-tint text-accent-text">
              <Icon d={icon} class="h-[18px] w-[18px]" />
            </span>
            <span class="flex flex-col gap-0.5">
              <span class="text-[13px] font-semibold leading-snug">{name}</span>
              <span class="text-xs text-ink-2">{what}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const startLink = (host: string, label: string) => (
  <a
    href={addDomainUrl(host)}
    target="_blank"
    rel="noreferrer"
    class={cx(ON_HERO_PRIMARY, 'h-10 px-5 text-sm')}
    onClick={() => track('promo.click')}
  >
    {label}
  </a>
);

/** The VitalSentinel tab, signed out: the free plan first, sign-in beside it. */
export function SignInPitch({ ctx, reload }: { ctx: TabContext; reload: () => void }) {
  const host = hostOf(ctx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await send('auth:signIn', {});
      if (res.ok) {
        track('signin');
        reload();
      } else setError(res.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pitch>
      <Hero
        title={
          <>
            <span class="block">Your site breaks quietly.</span>
            <span class="block text-accent-on/80">We make sure you hear it.</span>
          </>
        }
        text="All-in-one website monitoring that watches every signal and alerts you in minutes, before a problem hits your revenue – free for one domain."
      >
        {startLink(host, 'Start monitoring free')}
        <button
          type="button"
          class={cx(ON_HERO_SECONDARY, 'h-10 px-5 text-sm')}
          disabled={busy}
          onClick={signIn}
        >
          {busy ? 'Signing in…' : 'Sign in with VitalSentinel'}
        </button>
      </Hero>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Modules />
      <p class="text-xs leading-normal text-ink-3">
        Once connected, this tab shows VitalSentinel’s data on every page you visit. Sign-in opens
        VitalSentinel in a new window; the extension gets read access to your workspaces and can add
        pages to monitoring. Every other report works without an account.
      </p>
    </Pitch>
  );
}

/** The VitalSentinel tab, signed in, for a site none of the workspaces monitors. */
export function StartMonitoring({ ctx, reload }: { ctx: TabContext; reload: () => void }) {
  const host = hostOf(ctx);
  const n = ctx.auth.workspaces.length;
  return (
    <Pitch>
      <div class="flex flex-col gap-5 rounded-card border border-border px-6 py-6">
        <div class="flex items-start gap-3.5">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-tint text-accent-text">
            <Icon d="M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20zM12 16v-4M12 8h.01" class="h-5 w-5" />
          </span>
          <span class="flex min-w-0 flex-col gap-1">
            <h1 class="font-display text-[19px] font-bold leading-tight">
              {host} is not monitored in VitalSentinel
            </h1>
            <span class="text-ink-2">
              {n > 1
                ? `None of your ${n} workspaces monitors it`
                : 'Your workspace does not monitor it'}
              , so the reports show what this browser measures on the page.
            </span>
          </span>
        </div>
        <div class="flex items-center gap-4 rounded-[10px] bg-accent-tint px-4 py-3">
          <span class="flex-grow text-xs leading-normal text-ink-2">
            Add it to a workspace and the reports fill with its Google Search Console, Google index,
            CrUX and Web Analytics data.
          </span>
          <LinkButton
            href={addDomainUrl(host)}
            variant="primary"
            onClick={() => track('promo.click')}
          >
            Add {host} ↗
          </LinkButton>
        </div>
      </div>
      <p class="text-xs text-ink-3">
        Wrong account?{' '}
        <button
          type="button"
          class="font-medium text-accent-text hover:underline"
          onClick={async () => {
            await send('auth:signOut', {});
            track('signout');
            reload();
          }}
        >
          Sign out
        </button>
      </p>
    </Pitch>
  );
}
