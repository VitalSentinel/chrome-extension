import { browser } from 'wxt/browser';
import { API_PREFIX, API_URL, TERMS_VERSION } from '../lib/config';
import {
  allowedCounts,
  bump,
  usageAllowed,
  usageReport,
  utcDay,
  type UsageDays,
  type UsageEvent,
} from '../lib/usage';
import { isSignedIn } from './auth';
import { getLocal, getSettings, setLocal } from './store';

// Anonymous usage statistics and error counts. Counters are summed per UTC day in storage.local
// and each finished day is sent once, without a token or cookies, so a report cannot be tied to
// an account. Today's counters wait for tomorrow. Nothing is counted or sent while its switch is
// off, offline mode is on or the Terms are not accepted; turning a switch off deletes its
// counters that were not sent yet.

export const USAGE_KEY = 'usage';
const LAST_TRY_KEY = 'usage:lastTry';
const RETRY_MS = 60 * 60 * 1000;
const MAX_AGE_DAYS = 7;

// Every read-modify-write runs in order, so counts from parallel messages are never lost.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

/** After a settings change: drops the counters the settings no longer allow. */
export function pruneUsage(): Promise<void> {
  return serial(async () => {
    const s = await getSettings();
    if (!usageAllowed(s, TERMS_VERSION))
      return browser.storage.local.remove([USAGE_KEY, LAST_TRY_KEY]);
    const days = (await getLocal<UsageDays>(USAGE_KEY)) ?? {};
    const kept: UsageDays = {};
    for (const [day, counts] of Object.entries(days)) {
      const c = allowedCounts(counts, s);
      if (Object.keys(c).length) kept[day] = c;
    }
    await setLocal(USAGE_KEY, kept);
  });
}

export function count(event: UsageEvent, now = Date.now()): Promise<void> {
  return serial(async () => {
    if (!usageAllowed(await getSettings(), TERMS_VERSION, event)) return;
    await setLocal(USAGE_KEY, bump((await getLocal<UsageDays>(USAGE_KEY)) ?? {}, event, now));
  }).then(() => sendDue(now));
}

/**
 * Sends every finished day; failures are retried an hour later and dropped after 7 days. The
 * days are picked and removed under the queue, but sent outside it, so counting never waits
 * on the network.
 */
export async function sendDue(now = Date.now()): Promise<void> {
  const plan = await serial(async () => {
    const settings = await getSettings();
    if (!usageAllowed(settings, TERMS_VERSION)) return null;
    const days = (await getLocal<UsageDays>(USAGE_KEY)) ?? {};
    const today = utcDay(now);
    const due = Object.keys(days).filter((d) => d < today);
    if (!due.length) return null;
    if (now - ((await getLocal<number>(LAST_TRY_KEY)) ?? 0) < RETRY_MS) return null;
    await setLocal(LAST_TRY_KEY, now);
    return { settings, days, due };
  });
  if (!plan) return;

  const { settings, days, due } = plan;
  const oldest = utcDay(now - MAX_AGE_DAYS * 86_400_000);
  const env = {
    version: browser.runtime.getManifest().version,
    browser: navigator.userAgent.includes(' Edg/') ? ('edge' as const) : ('chrome' as const),
    build: import.meta.env.MODE === 'production' ? ('store' as const) : ('dev' as const),
    lang: browser.i18n.getUILanguage().slice(0, 2).toLowerCase(),
    signedIn: await isSignedIn(),
  };
  const done: string[] = [];
  for (const day of due) {
    const counts = allowedCounts(days[day]!, settings);
    if (day < oldest || !Object.keys(counts).length) {
      done.push(day);
      continue;
    }
    try {
      const res = await fetch(`${API_URL}${API_PREFIX}/extension/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify(usageReport(day, counts, settings, env)),
        signal: AbortSignal.timeout(10_000),
      });
      // Kept for a retry on a server error, a timeout or a rate limit; any other refusal is final.
      if (res.ok || (res.status < 500 && res.status !== 408 && res.status !== 429)) done.push(day);
    } catch {
      // Network error: kept for the next try.
    }
  }
  if (!done.length) return;
  await serial(async () => {
    const left = (await getLocal<UsageDays>(USAGE_KEY)) ?? {};
    for (const day of done) delete left[day];
    await setLocal(USAGE_KEY, left);
  });
}
