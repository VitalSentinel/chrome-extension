import { browser } from 'wxt/browser';
import { API_PREFIX, API_URL, DR_TTL_MS, TERMS_VERSION } from '../lib/config';
import type { DomainRating } from '../lib/types';
import { isPublicHost, siteOf } from '../lib/url';
import { getLocal, getSettings, setLocal } from './store';
import { count } from './usage';

// Domain Rating through the VitalSentinel app, which fetches it from Ahrefs' free endpoint and
// caches it for 7 days. The extension caches each answer for 7 days too, keyed by site, so a
// domain costs at most one request a week from this browser. Failures are cached briefly.

const RETRY_MS = 60 * 60 * 1000;

type Cached = { at: number; value: DomainRating | null; error: string | null };

const inflight = new Map<string, Promise<Cached>>();

/** `site` is the registrable domain – the full host never leaves the browser. */
async function fetchDr(site: string): Promise<Cached> {
  // Always anonymous, signed in or not, so a lookup can never be tied to an account.
  const headers = { Accept: 'application/json' };
  try {
    const res = await fetch(
      `${API_URL}${API_PREFIX}/domain-rating?target=${encodeURIComponent(site)}`,
      { headers, credentials: 'omit', signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok)
      return {
        at: Date.now(),
        value: null,
        error: res.status === 422 ? 'unsupported' : `HTTP ${res.status}`,
      };
    const body = (await res.json()) as {
      domain: string;
      domain_rating: number | null;
      fetched_at: string;
      stale: boolean;
    };
    return {
      at: Date.now(),
      value: {
        domain: body.domain,
        domainRating: body.domain_rating,
        fetchedAt: body.fetched_at,
        stale: body.stale,
      },
      error: null,
    };
  } catch {
    return { at: Date.now(), value: null, error: 'network' };
  }
}

export async function domainRating(
  host: string,
): Promise<{ dr: DomainRating | null; error: string | null }> {
  if (!isPublicHost(host)) return { dr: null, error: 'unsupported' };
  const settings = await getSettings();
  if (!settings.drConsent || settings.termsAccepted !== TERMS_VERSION)
    return { dr: null, error: 'no_consent' };
  if (settings.offline) return { dr: null, error: 'offline' };
  const site = siteOf(host);
  const key = `dr:${site}`;
  const hit = await getLocal<Cached>(key);
  const ttl = hit?.value ? DR_TTL_MS : hit?.error === 'unsupported' ? DR_TTL_MS : RETRY_MS;
  if (hit && Date.now() - hit.at < ttl) return { dr: hit.value, error: hit.error };
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchDr(site).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const fresh = await pending;
  if (fresh.error === 'network' || /^HTTP 5/.test(fresh.error ?? '')) void count('error.dr');
  // Keep the last good value when a refresh fails.
  const keep = !fresh.value && hit?.value ? { ...hit, at: fresh.at - DR_TTL_MS + RETRY_MS } : fresh;
  await setLocal(key, keep);
  return { dr: keep.value, error: keep.value ? null : keep.error };
}

/**
 * Deletes cached ratings older than the cache lifetime, or all of them once the lookup or the
 * badge is turned off, so the cache never becomes a list of the sites visited long ago.
 */
export async function pruneDr(now = Date.now()): Promise<void> {
  const settings = await getSettings();
  const all = !settings.drConsent || !settings.showDrBadge;
  const stored = await browser.storage.local.get(null);
  const old = Object.entries(stored)
    .filter(([k, v]) => k.startsWith('dr:') && (all || now - (v as Cached).at > DR_TTL_MS))
    .map(([k]) => k);
  if (old.length) await browser.storage.local.remove(old);
}
