import type { Domain, Me, Page, UrlOverview, WatchCreated, Workspace } from '../lib/app';
import { API_PREFIX, API_URL, DOMAINS_TTL_MS, OVERVIEW_TTL_MS } from '../lib/config';
import type { ApiResult, AuthState } from '../lib/messages';
import { withoutTracking } from '../lib/url';
import { accessToken, isSignedIn } from './auth';
import { browser } from 'wxt/browser';
import {
  cached,
  cachedNow,
  failedKey,
  forgetLoads,
  getSession,
  getSettings,
  RETRY_MS,
  setSession,
} from './store';

// Calls to the VitalSentinel public API. Only the worker holds tokens; the popup asks it.

// Bumped on sign-in and sign-out, so a load started for the previous account is not cached.
let account = 0;
function accountCached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const started = account;
  return cached(key, ttl, load, Date.now(), () => started === account);
}

/** accountCached, or with `wait` off only what is cached now (the load runs in the background). */
function accountValue<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
  wait: boolean,
): Promise<T | undefined> {
  if (wait) return accountCached(key, ttl, load);
  const started = account;
  return cachedNow(key, ttl, load, () => started === account);
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<ApiResult<T>> {
  if ((await getSettings()).offline) return { ok: false, status: 0, error: 'offline' };
  const token = await accessToken(retried);
  if (!token) return { ok: false, status: 401, error: 'signed_out' };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${API_PREFIX}${path}`, {
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
  if (res.status === 401 && !retried) return call(path, init, true);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body as { detail?: string; title?: string; code?: string } | null) ?? {};
    return {
      ok: false,
      status: res.status,
      error: detail.code || detail.detail || detail.title || `HTTP ${res.status}`,
    };
  }
  return { ok: true, data: body as T };
}

export function unwrap<T>(r: ApiResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/**
 * The signed-in account. With `wait` off it never waits for the API: it answers from the cache,
 * or with no workspaces yet, and the popup reloads when the load lands in storage.
 */
export async function authState(wait = true): Promise<AuthState> {
  if (!(await isSignedIn())) return { signedIn: false, workspaces: [], roles: {} };
  try {
    const cachedAccount = await accountValue(
      'app:account',
      DOMAINS_TTL_MS,
      async () => {
        const [ws, me] = await Promise.all([call<Page<Workspace>>('/workspaces'), call<Me>('/me')]);
        const m = unwrap(me);
        return {
          workspaces: unwrap(ws).items,
          roles: m.roles,
          user: m.name || m.email || undefined,
        };
      },
      wait,
    );
    if (!cachedAccount)
      return { signedIn: true, workspaces: [], roles: {}, pending: await pending() };
    const { workspaces, roles, user } = cachedAccount;
    return {
      signedIn: await isSignedIn(),
      workspaces,
      roles,
      user,
      ...(wait ? {} : { pending: await pending() }),
    };
  } catch {
    return { signedIn: await isSignedIn(), workspaces: [], roles: {} };
  }
}

const ACCOUNT_KEYS = ['app:account', 'app:domains'];

/** Whether the account or domain list is still missing from the cache, and why. */
async function pending(): Promise<AuthState['pending']> {
  const store = await browser.storage.local.get([...ACCOUNT_KEYS, ...ACCOUNT_KEYS.map(failedKey)]);
  if (ACCOUNT_KEYS.every((k) => store[k])) return undefined;
  const failedAt = Math.max(0, ...ACCOUNT_KEYS.map((k) => (store[failedKey(k)] as number) ?? 0));
  return Date.now() - failedAt < RETRY_MS ? 'failed' : 'loading';
}

export async function domains(wait = true): Promise<Domain[]> {
  if (!(await isSignedIn())) return [];
  try {
    return (
      (await accountValue(
        'app:domains',
        DOMAINS_TTL_MS,
        async () => unwrap(await call<Page<Domain>>('/domains?include_modules=true')).items,
        wait,
      )) ?? []
    );
  } catch {
    return [];
  }
}

// url-overview answers per page, in storage.session so they outlive the worker sleeping; the
// app caches them for as long, so a refresh is the only way to newer data.
const OVERVIEW = 'app:overview:';
const OVERVIEW_SECTIONS = 'search_console,indexing,crux,web_analytics,crawl';
const overviewKey = (domainId: string, url: string) => `${OVERVIEW}${domainId}:${url}`;

// Bumped per domain when a page is watched or unwatched: an answer asked for before that
// carries the old watch state, so it is not cached. The app drops its own cache of the URL.
const watchChanges = new Map<string, number>();

async function overviewKeys(): Promise<string[]> {
  return Object.keys(await browser.storage.session.get(null)).filter((k) => k.startsWith(OVERVIEW));
}

export async function urlOverview(
  domainId: string,
  url: string,
  refresh = false,
): Promise<ApiResult<UrlOverview>> {
  // A visit tagged for a campaign reads the clean page's data, and the app never sees the tags.
  url = withoutTracking(url);
  const key = overviewKey(domainId, url);
  const hit = await getSession<{ at: number; data: UrlOverview }>(key);
  if (!refresh && hit && Date.now() - hit.at < OVERVIEW_TTL_MS) return { ok: true, data: hit.data };
  const started = account;
  const generation = watchChanges.get(domainId) ?? 0;
  const q = new URLSearchParams({
    url,
    fallback: 'domain',
    sections: OVERVIEW_SECTIONS,
    days: '90',
  });
  const res = await call<UrlOverview>(`/domains/${domainId}/url-overview?${q}`);
  if (res.ok && started === account && generation === (watchChanges.get(domainId) ?? 0)) {
    // The data arrived; a full or busy session store must not turn it into an error.
    try {
      const keys = (await overviewKeys()).filter((k) => k !== key);
      if (keys.length >= 50) {
        const all = await browser.storage.session.get(keys);
        const at = (k: string) => (all[k] as { at: number } | undefined)?.at ?? 0;
        const oldest = keys.sort((x, y) => at(x) - at(y));
        await browser.storage.session.remove(oldest.slice(0, keys.length - 49));
      }
      await setSession(key, { at: Date.now(), data: res.data });
    } catch {
      // Not cached; the next ask loads it again.
    }
  }
  return res;
}

// The page's answers carry its watch state; drop the domain's, as the popup may have asked
// with the page's own URL or the tab's.
async function forgetOverviews(domainId: string) {
  watchChanges.set(domainId, (watchChanges.get(domainId) ?? 0) + 1);
  await browser.storage.session.remove(
    (await overviewKeys()).filter((k) => k.startsWith(`${OVERVIEW}${domainId}:`)),
  );
}

export async function watchPage(domainId: string, url: string): Promise<ApiResult<WatchCreated>> {
  const res = await call<WatchCreated>(`/domains/${domainId}/page-monitoring/watches`, {
    method: 'POST',
    body: JSON.stringify({ url: withoutTracking(url) }),
  });
  if (res.ok) await forgetOverviews(domainId);
  return res;
}

export async function unwatchPage(domainId: string, watchId: string): Promise<ApiResult<null>> {
  const res = await call<null>(`/domains/${domainId}/page-monitoring/watches/${watchId}`, {
    method: 'DELETE',
  });
  if (res.ok) await forgetOverviews(domainId);
  return res;
}

export async function forgetAccount() {
  account++;
  forgetLoads();
  const keys = Object.keys(await browser.storage.local.get(null)).filter((k) =>
    k.startsWith('app:'),
  );
  await Promise.all([
    browser.storage.local.remove(keys),
    browser.storage.session.remove(await overviewKeys()),
  ]);
}
