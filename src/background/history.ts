import { browser } from 'wxt/browser';
import { DIGEST_INDEX, pruneIndex } from '../lib/history';

/** Drops "Changed since your last visit" snapshots past 30 days or 2,000 pages, on worker start. */
export async function pruneHistory(now = Date.now()): Promise<void> {
  const index =
    ((await browser.storage.local.get(DIGEST_INDEX))[DIGEST_INDEX] as [string, number][]) ?? [];
  const { keep, drop } = pruneIndex(index, now);
  if (!drop.length) return;
  await browser.storage.local.set({ [DIGEST_INDEX]: keep });
  await browser.storage.local.remove(drop);
}
