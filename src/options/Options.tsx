import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { exportRules, isValidPattern, patternLabel, type JsRule } from '../lib/jsRules';
import { send, type AuthState } from '../lib/messages';
import type { Settings } from '../lib/settings';
import { date } from '../lib/format';
import { Button, Card, ErrorNote, Select, Switch, Table, cx, toggleRow } from '../ui/kit';
import logo from '../assets/logo.svg';
import logoDark from '../assets/logo-dark.svg';
import { saveSettings, settings as loadSettings, track } from '../popup/data';
import { Hero, ON_HERO_PRIMARY, ON_HERO_SECONDARY } from '../popup/Promo';
import { APP_URL } from '../lib/config';
import { accountLabel } from '../lib/app';

const SIGN_UP = `${APP_URL}/register?utm_source=extension&utm_medium=settings`;

// Lucide-style 24px stroke icons, one per section.
const glyph = (paths: string[]) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

const SECTIONS = [
  {
    id: 'account',
    label: 'Account',
    icon: glyph(['M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M20 21a8 8 0 0 0-16 0']),
  },
  { id: 'js', label: 'JavaScript rules', icon: glyph(['m16 18 6-6-6-6', 'm8 6-6 6 6 6']) },
  {
    id: 'icon',
    label: 'Toolbar icon',
    icon: glyph([
      'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
      'M2 9h20',
      'M6 6.5h.01',
      'M9 6.5h.01',
    ]),
  },
  {
    id: 'privacy',
    label: 'Data sources and privacy',
    icon: glyph([
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ]),
  },
  {
    id: 'keys',
    label: 'Keyboard shortcuts',
    icon: glyph([
      'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
      'M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01',
      'M7 16h10',
    ]),
  },
];

// Scroll-spy for the one long page: the first section in the top 40% of the window is current,
// the last one once the end of a scrolled page is in view. A click marks its section straight
// away and holds it until that scroll ends (or a second at most, when nothing scrolls), so the
// sections scrolled past do not flicker by. The hold lives outside the hook: it is read in
// observer callbacks, never during render.
let held = false;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let repick = () => {};
const release = () => {
  held = false;
  clearTimeout(holdTimer);
  repick();
};
function useCurrentSection(ready: boolean) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready) return;
    held = false;
    const inView = new Set<string>();
    let atEnd = false;
    const pick = () => {
      // An unscrolled page that fits the window has its end in view from the start.
      const last = atEnd && scrollY > 0;
      const id = last ? SECTIONS.at(-1)!.id : SECTIONS.find((x) => inView.has(x.id))?.id;
      if (id && !held) setActive(id);
    };
    const band = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) inView.add(e.target.id);
          else inView.delete(e.target.id);
        pick();
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    const bottom = new IntersectionObserver(([e]) => {
      atEnd = e.isIntersecting;
      pick();
    });
    for (const { id } of SECTIONS) band.observe(document.getElementById(id)!);
    bottom.observe(end.current!);
    repick = pick;
    const events = ['scrollend', 'wheel', 'touchstart', 'keydown', 'pointerdown'];
    for (const t of events) addEventListener(t, release, { passive: true });
    return () => {
      band.disconnect();
      bottom.disconnect();
      for (const t of events) removeEventListener(t, release);
      clearTimeout(holdTimer);
      repick = () => {};
    };
  }, [ready]);

  const go = (id: string) => {
    const el = document.getElementById(id)!;
    held = true;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(release, 1000);
    setActive(id);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    history.replaceState(null, '', `#${id}`);
  };
  return { active, go, end };
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ComponentChildren;
}) {
  return (
    <div
      class="flex cursor-pointer items-center gap-8 border-t border-hairline py-5 first:border-t-0"
      onClick={toggleRow}
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="text-[15.5px] font-semibold">{label}</span>
        {hint && <span class="text-[14.5px] leading-relaxed text-ink-2">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Block({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    // Focusable so a click in the side nav moves keyboard focus here too.
    <section id={id} tabIndex={-1} class="flex scroll-mt-12 flex-col gap-5 focus:outline-none">
      <div class="flex flex-col gap-1.5">
        <h2 class="font-display text-[21px] font-bold">{title}</h2>
        {intro && <p class="max-w-[720px] leading-relaxed text-ink-2">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function JsRules() {
  const [rules, setRules] = useState<JsRule[]>([]);
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void send('js:rules', {}).then(setRules), []);
  const save = async (next: JsRule[]) => setRules(await send('js:saveRules', { rules: next }));

  const add = () => {
    // Accepts a host, [*.]domain, or a full URL; the rule always covers the whole site.
    const host = pattern
      .trim()
      .replace(/^(\*|https?):\/\//, '')
      .replace(/\/.*$/, '');
    const p = `*://${host}/*`;
    if (!host || !isValidPattern(p))
      return setError('Enter a host such as shop.example.com or [*.]example.com');
    setError(null);
    setPattern('');
    void save([
      { pattern: p, setting: 'block', addedAt: Date.now() },
      ...rules.filter((r) => r.pattern !== p),
    ]);
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportRules(rules)], { type: 'application/json' }));
    a.download = 'vitalsentinel-js-rules.json';
    a.click();
  };

  return (
    <Block
      id="js"
      title="JavaScript rules"
      intro={
        <>
          Toggle from the popup, the right-click menu or{' '}
          <kbd class="mono rounded border border-border px-1">Alt+Shift+Q</kbd>. The tab reloads
          after each change. Rules made in an incognito window last only for that session, as Chrome
          requires.
        </>
      }
    >
      <div class="flex flex-wrap items-center gap-3">
        <input
          value={pattern}
          onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Host, such as shop.example.com or [*.]example.com"
          aria-label="Host to block JavaScript on"
          class="h-10 w-[400px] rounded-pill border border-control bg-surface px-5 text-[14.5px] placeholder:text-ink-3"
        />
        <Button variant="primary" size="md" onClick={add}>
          Block JavaScript
        </Button>
        <span class="ml-auto flex gap-3">
          <Button size="md" onClick={download} disabled={!rules.length}>
            Export
          </Button>
          <Button size="md" onClick={() => save([])} disabled={!rules.length}>
            Remove all
          </Button>
        </span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Table
        columns={[
          { label: 'Pattern', render: (r) => <span class="mono">{patternLabel(r.pattern)}</span> },
          {
            label: 'Applies to',
            width: '170px',
            render: (r) =>
              r.pattern.includes('[*.]') ? 'Domain and subdomains' : 'This host only',
          },
          {
            label: 'JavaScript',
            width: '120px',
            render: (r) => (
              <Select
                label={`JavaScript on ${patternLabel(r.pattern)}`}
                value={r.setting}
                options={[
                  ['block', 'Blocked'],
                  ['allow', 'Allowed'],
                ]}
                onChange={(v) =>
                  save(
                    rules.map((x) =>
                      x.pattern === r.pattern ? { ...x, setting: v as JsRule['setting'] } : x,
                    ),
                  )
                }
              />
            ),
          },
          {
            label: 'Added',
            width: '130px',
            render: (r) => date(new Date(r.addedAt).toISOString()),
          },
          {
            label: '',
            width: '80px',
            render: (r) => (
              <Button
                variant="ghost"
                onClick={() => save(rules.filter((x) => x.pattern !== r.pattern))}
              >
                Remove
              </Button>
            ),
          },
        ]}
        rows={rules}
        empty="No rules yet. JavaScript runs everywhere."
      />
    </Block>
  );
}

function Account() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void send('auth:state', {}).then(setAuth), []);
  const signIn = async () => {
    const res = await send('auth:signIn', {});
    if (res.ok) {
      setAuth(res.data);
      track('signin');
    } else setError(res.error);
  };
  const account = auth?.signedIn ? accountLabel(auth) : null;
  return (
    <Block id="account" title="Account">
      {auth?.signedIn ? (
        <Card class="divide-y divide-hairline">
          <div class="flex items-center gap-4 px-6 py-5">
            <span
              aria-hidden="true"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-tint text-[14px] font-bold text-accent-text"
            >
              {account!.initials}
            </span>
            <span class="flex min-w-0 flex-grow flex-col gap-0.5">
              <span class="truncate text-[15.5px] font-semibold">{account!.title}</span>
              <span class="truncate text-[13.5px] text-ink-2">Signed in with VitalSentinel</span>
            </span>
            <Button
              size="md"
              onClick={async () => {
                setAuth(await send('auth:signOut', {}));
                track('signout');
              }}
            >
              Sign out
            </Button>
          </div>
          {auth.workspaces.length > 0 && (
            <div class="flex flex-col gap-2.5 px-6 py-4">
              <span class="text-[13.5px] font-semibold text-ink-2">
                {auth.workspaces.length === 1
                  ? 'Workspace'
                  : `Workspaces · ${auth.workspaces.length}`}
              </span>
              <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
                {auth.workspaces.map((w) => (
                  <li
                    key={w.id}
                    class="rounded-pill border border-border bg-surface-inset px-3 py-1 text-[13.5px]"
                  >
                    {w.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ) : (
        <Hero
          heading="h2"
          title="Monitor one domain free with VitalSentinel"
          text="Sign in to see the CrUX data Google ranks on, real-user Core Web Vitals, Google Search Console and indexing for your own site, right in the popup. Every report here works without an account."
        >
          <a
            href={SIGN_UP}
            target="_blank"
            rel="noreferrer"
            onClick={() => track('promo.click')}
            class={cx(ON_HERO_PRIMARY, 'h-10 px-5 text-sm')}
          >
            Start free
          </a>
          <button type="button" class={cx(ON_HERO_SECONDARY, 'h-10 px-5 text-sm')} onClick={signIn}>
            Sign in with VitalSentinel
          </button>
        </Hero>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <p class="text-[14.5px] text-ink-3">
        You can also revoke the extension in the app under Settings › Connected apps.
      </p>
    </Block>
  );
}

export function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [cleared, setCleared] = useState<{ ok: boolean; text: string } | null>(null);
  const { active, go, end } = useCurrentSection(!!s);
  useEffect(() => {
    void loadSettings().then(setS);
    track('settings.open');
  }, []);
  const set = async (patch: Partial<Settings>) => {
    setS(await saveSettings(patch));
    await send('badge:refresh', {});
  };
  if (!s) return null;

  // The same keys "Clear history" removes; switching the history off removes them too.
  const clearHistory = async () => {
    const all = await browser.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('digest'));
    await browser.storage.local.remove(keys);
    return keys.filter((k) => k.startsWith('digest:')).length;
  };
  const clearNow = async () => {
    setCleared(null);
    try {
      const n = await clearHistory();
      setCleared({
        ok: true,
        text: n ? `Cleared ${n} page${n === 1 ? '' : 's'}` : 'Nothing to clear',
      });
      setTimeout(() => setCleared(null), 4000);
    } catch {
      setCleared({ ok: false, text: 'Could not clear the history' });
    }
  };

  return (
    <div class="mx-auto flex max-w-[1160px] gap-14 px-10 py-12">
      <div class="sticky top-12 flex h-fit w-[248px] shrink-0 flex-col gap-6">
        <img src={logo} alt="VitalSentinel" class="h-10 w-auto self-start px-2 dark:hidden" />
        <img
          src={logoDark}
          alt="VitalSentinel"
          class="hidden h-10 w-auto self-start px-2 dark:block"
        />
        <nav
          aria-label="Settings"
          class="flex flex-col gap-1 rounded-card border border-border bg-surface-inset p-2.5"
        >
          {SECTIONS.map(({ id, label, icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(id);
              }}
              class={cx(
                'flex items-center gap-3 rounded-pill px-3.5 py-2 text-[14px] no-underline hover:no-underline',
                active === id
                  ? 'bg-accent-tint font-semibold text-accent-text'
                  : 'text-ink hover:bg-hover',
              )}
            >
              <span class={active === id ? '' : 'text-ink-2'}>{icon}</span>
              {label}
            </a>
          ))}
        </nav>
      </div>
      <main class="flex min-w-0 flex-grow flex-col gap-14">
        <div class="flex flex-col gap-2">
          <h1 class="font-display text-[30px] font-bold leading-tight">Settings</h1>
          <p class="text-ink-2">Changes are saved as you make them.</p>
        </div>
        <Account />
        <JsRules />
        <Block id="icon" title="Toolbar icon">
          <Card class="px-6 py-1">
            <Row
              label="Show Domain Rating on the badge"
              hint="Domain Rating by Ahrefs. Needs the Domain Rating lookup below."
            >
              <Switch
                large
                checked={s.showDrBadge}
                onChange={(v) => set({ showDrBadge: v })}
                label="Show Domain Rating on the badge"
              />
            </Row>
            <Row
              label="Colour the badge by Core Web Vitals"
              hint="Green, amber or red from this page load's LCP, INP and CLS, measured on your device. No request is made."
            >
              <Switch
                large
                checked={s.cwvBadgeColour}
                onChange={(v) => set({ cwvBadgeColour: v })}
                label="Colour the badge by Core Web Vitals"
              />
            </Row>
          </Card>
        </Block>
        <Block id="privacy" title="Data sources and privacy">
          <Card class="px-6 py-1">
            <Row
              label="Domain Rating lookup"
              hint="Sends the domain of each site you visit to VitalSentinel, which looks up its Domain Rating with Ahrefs. No full URLs, no record of who asked."
            >
              <Switch
                large
                checked={s.drConsent}
                onChange={(v) => set({ drConsent: v })}
                label="Domain Rating lookup"
              />
            </Row>
            <Row
              label="Remember pages for “Changed since your last visit”"
              hint="A short summary of each page you analyse is kept in this browser for 30 days."
            >
              <span class="relative flex shrink-0 items-center gap-3.5">
                {/* Floats left of the button, so showing it never reflows the row's text. */}
                <span role="status" class="absolute right-full top-1/2 mr-3 -translate-y-1/2">
                  {cleared && (
                    <span
                      class={cx(
                        'whitespace-nowrap rounded-pill px-3 py-1.5 text-[13.5px] font-medium shadow-sm',
                        cleared.ok ? 'bg-good-tint text-good-text' : 'bg-poor-tint text-poor-text',
                      )}
                    >
                      {`${cleared.ok ? '✓ ' : ''}${cleared.text}`}
                    </span>
                  )}
                </span>
                <Button onClick={clearNow}>Clear history</Button>
                <Switch
                  large
                  checked={s.rememberChanges}
                  onChange={async (v) => {
                    await set({ rememberChanges: v });
                    if (!v) await clearHistory();
                  }}
                  label="Remember pages"
                />
              </span>
            </Row>
            <Row
              label="Offline mode"
              hint="No requests to VitalSentinel; only the site you are on is contacted. Domain Rating is hidden."
            >
              <Switch
                large
                checked={s.offline}
                onChange={(v) => set({ offline: v })}
                label="Offline mode"
              />
            </Row>
            <Row
              label="Share anonymous usage and error counts"
              hint="Once a day, which features you use and how often something fails, so we can fix bugs and improve features. Never the pages you visit."
            >
              <Switch
                large
                checked={s.usageStats || s.errorReports}
                onChange={(v) => set({ usageStats: v, errorReports: v })}
                label="Share anonymous usage and error counts"
              />
            </Row>
          </Card>
        </Block>
        <Block id="keys" title="Keyboard shortcuts">
          <Card class="flex items-center gap-6 px-6 py-5">
            <span class="flex-grow text-[15.5px]">
              <kbd class="mono rounded border border-border px-1">Alt+Shift+Q</kbd> turns JavaScript
              on or off for the current site.
            </span>
            <Button
              size="md"
              onClick={() => browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
            >
              Change shortcuts
            </Button>
          </Card>
        </Block>
        <div ref={end} />
      </main>
    </div>
  );
}
