// Change-history index: pure, shared by the popup (on each analysis) and the worker (on start).

export const DIGEST_INDEX = 'digest-index';
const DIGEST_MAX = 2000;
const DIGEST_DAYS = 30;

/** Keeps the newest 2,000 page summaries younger than 30 days; newest first in, as stored. */
export function pruneIndex(
  index: [string, number][],
  now: number,
): { keep: [string, number][]; drop: string[] } {
  const keep: [string, number][] = [];
  const drop: string[] = [];
  for (const entry of index) {
    if (keep.length < DIGEST_MAX && now - entry[1] <= DIGEST_DAYS * 86400_000) keep.push(entry);
    else drop.push(entry[0]);
  }
  return { keep, drop };
}
