import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { TabContext } from '../lib/messages';
import { UTM } from '../lib/config';
import { send } from '../lib/messages';
import { Switch, cx } from '../ui/kit';
import logo from '../assets/logo.svg';
import logoDark from '../assets/logo-dark.svg';
import mark from '../assets/logo-mark.svg';
import { accountLabel } from '../lib/app';
import { sum, type Count } from './badges';
import { track } from './data';
import { GROUPS, groupOf, type PageKey } from './nav';

// Accordion sidebar: a group lists its pages only while one of them is open.

// Every trailing mark – count or lock – sits centred in this one fixed column.
const Trail = ({ children }: { children: ComponentChildren }) => (
  <span class="flex h-[18px] min-w-[22px] shrink-0 items-center justify-center">{children}</span>
);

// Filled when an error is among the count, outlined for warnings only, and named for screen
// readers, so the level never rests on colour alone.
function Badge({ count, label }: { count?: Count; label?: string }) {
  if (!count?.n) return null;
  const { n, bad } = count;
  return (
    <Trail>
      <span
        role="img"
        aria-label={
          label ??
          (bad
            ? n === 1
              ? '1 error'
              : `${n} issues, including errors`
            : n === 1
              ? '1 warning'
              : `${n} warnings`)
        }
        class={cx(
          'flex h-[18px] min-w-[22px] items-center justify-center rounded-pill border px-1 text-2xs font-bold leading-none',
          bad
            ? 'border-poor-solid bg-poor-solid text-white'
            : 'border-warn bg-warn-tint text-warn-text',
        )}
      >
        {n}
      </span>
    </Trail>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class={cx('shrink-0', !open && 'text-ink-3')}
  >
    <path d={open ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
  </svg>
);

const rowBase =
  'flex h-[34px] w-full items-center gap-1.5 rounded-pill pl-1.5 pr-2.5 text-left no-underline hover:no-underline';
const subBase =
  'ml-[20px] flex h-[30px] items-center rounded-pill px-2.5 text-left text-[12.5px] no-underline hover:no-underline';

export function Sidebar({
  page,
  go,
  counts,
  ctx,
  reload,
}: {
  page: PageKey;
  go: (p: PageKey) => void;
  counts: Partial<Record<PageKey, Count>>;
  ctx: TabContext;
  reload: () => void;
}) {
  const openGroup = groupOf(page);
  const web = /^https?:/.test(ctx.url);
  const vsOpen = page === 'vs-all';
  const signedIn = ctx.auth.signedIn;
  const account = accountLabel(ctx.auth);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const signIn = async () => {
    setSigningIn(true);
    setSignInError(null);
    const res = await send('auth:signIn', {}).catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setSigningIn(false);
    if (res.ok) {
      track('signin');
      reload();
    } else setSignInError(res.error);
  };

  return (
    <aside class="flex h-[600px] w-[200px] shrink-0 flex-col border-r border-border bg-surface-inset px-3 py-4">
      <a
        href={`https://www.vitalsentinel.com/?${UTM}`}
        target="_blank"
        rel="noreferrer"
        title="VitalSentinel website"
        class="block rounded-inner px-1.5 pb-3"
      >
        <img src={logo} alt="VitalSentinel" class="h-7 w-auto dark:hidden" />
        <img src={logoDark} alt="VitalSentinel" class="hidden h-7 w-auto dark:block" />
      </a>
      <nav
        aria-label="Report"
        class="scroll-thin flex min-h-0 flex-col gap-0.5 overflow-y-auto py-2.5"
      >
        <span class="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          This page
        </span>
        {GROUPS.map((g) => {
          const single = g.pages.length === 1;
          const expanded = !single && openGroup === g.key;
          const current = single && page === g.pages[0].key;
          return (
            <div key={g.key} class="flex flex-col gap-0.5">
              <button
                type="button"
                class={cx(
                  rowBase,
                  current
                    ? 'bg-accent-tint font-semibold text-accent-text'
                    : expanded
                      ? 'font-semibold text-accent-text'
                      : 'text-ink hover:bg-hover',
                )}
                aria-current={current ? 'page' : undefined}
                aria-expanded={single ? undefined : expanded}
                onClick={() => go(g.pages[0].key)}
              >
                {single ? <span class="w-3 shrink-0" /> : <Chevron open={expanded} />}
                <span class="flex-grow">{g.label}</span>
                {!expanded && <Badge count={sum(g.pages.map((p) => counts[p.key]))} />}
              </button>
              {expanded &&
                g.pages.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    class={cx(
                      subBase,
                      p.key === page
                        ? 'bg-accent-tint font-semibold text-accent-text'
                        : 'text-ink-2 hover:bg-hover',
                    )}
                    aria-current={p.key === page ? 'page' : undefined}
                    onClick={() => go(p.key)}
                  >
                    <span class="flex-grow">{p.label}</span>
                    <Badge count={counts[p.key]} />
                  </button>
                ))}
            </div>
          );
        })}
        <span class="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Your site
        </span>
        <button
          type="button"
          class={cx(
            rowBase,
            'pl-2.5',
            vsOpen ? 'bg-accent-tint font-semibold text-accent-text' : 'text-ink hover:bg-hover',
          )}
          aria-current={vsOpen ? 'page' : undefined}
          onClick={() => go('vs-all')}
        >
          <img src={mark} alt="" class="h-3.5 w-3.5" />
          <span class="flex-grow">VitalSentinel</span>
          {!signedIn && (
            <Trail>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="text-ink-3"
                role="img"
                aria-label="Sign-in required"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </Trail>
          )}
        </button>
      </nav>
      <div class="flex flex-col gap-px border-t border-border py-2.5">
        <span class="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Tools
        </span>
        <label class="flex h-8 items-center px-2.5">
          <span class="flex-grow">JavaScript</span>
          <Switch
            label="JavaScript on this site"
            checked={ctx.js === 'allow'}
            disabled={!web}
            onChange={async (on) => {
              await send('js:set', {
                tabId: ctx.tabId,
                url: ctx.url,
                setting: on ? 'allow' : 'block',
                scope: 'host',
              });
              reload();
            }}
          />
        </label>
        <button
          type="button"
          class="flex h-8 items-center rounded-pill px-2.5 text-left text-ink hover:bg-hover"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </div>
      <div class="mt-auto px-2.5 pb-2 text-2xs text-ink-2">
        Domain Rating by{' '}
        <a href="https://ahrefs.com/" target="_blank" rel="noreferrer" class="underline">
          Ahrefs
        </a>
      </div>
      {signedIn ? (
        <div class="flex items-center gap-2.5 border-t border-border px-1 pt-2">
          <span class="flex h-[30px] w-[26px] items-center justify-center rounded-full bg-accent-tint text-2xs font-bold text-accent-text">
            {account.initials}
          </span>
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-xs font-semibold" title={account.title}>
              {account.title}
            </span>
            <span class="truncate text-2xs text-ink-2">{account.detail}</span>
          </span>
        </div>
      ) : (
        <>
          {signInError && (
            <p role="alert" class="px-2.5 pb-1.5 text-2xs text-poor-text">
              {signInError}
            </p>
          )}
          <button
            type="button"
            class="flex h-[34px] items-center justify-center rounded-pill border border-accent/40 font-semibold text-accent-text hover:bg-accent-tint disabled:opacity-60"
            disabled={signingIn}
            onClick={signIn}
          >
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </>
      )}
    </aside>
  );
}
