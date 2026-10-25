import { browser } from 'wxt/browser';
import { SETTINGS_KEY, withDefaults, type Settings } from '../lib/settings';

export async function getLocal<T>(key: string): Promise<T | undefined> {
  return (await browser.storage.local.get(key))[key] as T | undefined;
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function getSession<T>(key: string): Promise<T | undefined> {
  return (await browser.storage.session.get(key))[key] as T | undefined;
}

export async function setSession(key: string, value: unknown): Promise<void> {
  await browser.storage.session.set({ [key]: value });
}

export async function getSettings(): Promise<Settings> {
  return withDefaults(await getLocal<Partial<Settings>>(SETTINGS_KEY));
}

const refreshing = new Map<string, Promise<unknown>>();

/** Set when a background load of `key` failed, so the popup can say so instead of waiting. */
export const failedKey = (key: string) => `${key}:failed`;
export const RETRY_MS = 60_000; // a failed background load is retried after this

/** Forgets loads in flight, so a caller after a sign-out never joins the old account's load. */
export function forgetLoads() {
  refreshing.clear();
}

/**
 * A value cached in storage.local with its write time. An expired value is still returned at
 * once and refreshed in the background, so a slow API never holds up the popup; only a miss
 * waits for the load.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  now = Date.now(),
  stillValid: () => boolean = () => true,
): Promise<T> {
  const hit = await getLocal<{ at: number; value: T }>(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  let next = refreshing.get(key) as Promise<T> | undefined;
  if (!next) {
    const load_: Promise<T> = load()
      .then(async (value) => {
        // A load that outlived its context (e.g. a sign-out) must not write stale data back.
        if (stillValid()) {
          await setLocal(key, { at: now, value });
          await browser.storage.local.remove(failedKey(key));
        }
        return value;
      })
      .finally(() => {
        // forgetLoads() may have let a newer load take this key since.
        if (refreshing.get(key) === load_) refreshing.delete(key);
      });
    next = load_;
    refreshing.set(key, next);
  }
  if (!hit) return next;
  next.catch(() => {});
  return hit.value;
}

/**
 * What the cache holds now, without waiting: a miss or an expired value starts the load in the
 * background (once per key) and answers undefined or the old value.
 */
export async function cachedNow<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  stillValid: () => boolean = () => true,
): Promise<T | undefined> {
  const hit = await getLocal<{ at: number; value: T }>(key);
  if (!hit || Date.now() - hit.at >= ttlMs) {
    // After a failure, wait before trying again: the marker reopens the popup's context, which
    // would otherwise start the next load straight away.
    const failedAt = await getLocal<number>(failedKey(key));
    if (!failedAt || Date.now() - failedAt >= RETRY_MS)
      cached(key, ttlMs, load, Date.now(), stillValid).catch(async () => {
        if (stillValid()) await setLocal(failedKey(key), Date.now());
      });
  }
  return hit?.value;
}
