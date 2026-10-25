import type { NavRecord, PageSnapshot } from '../types';
import { metaValue } from './content';
import { robotsDirectives } from './indexability';
import { parseJsonLd } from './schema';

// "Changed since your last visit": a small digest of the SEO-relevant parts of a page, kept
// per URL in chrome.storage.local, compared on the next visit.

export interface PageDigest {
  at: number;
  status: number;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: string;
  words: number;
  schema: string;
  hreflang: number;
  links: number;
}

export function digest(s: PageSnapshot, nav: NavRecord | null, at = Date.now()): PageDigest {
  return {
    at,
    status: nav?.status || s.status || 0,
    title: s.title,
    description: metaValue(s, 'description') ?? '',
    canonical: s.canonicals[0] ?? '',
    robots: [...robotsDirectives(s, nav)].sort().join(', '),
    h1: s.headings.find((h) => h.level === 1)?.text ?? '',
    words: s.wordCount,
    schema: [...new Set(parseJsonLd(s.jsonLd).items.map((i) => String(i['@type'])))]
      .sort()
      .join(', '),
    hreflang: s.hreflang.length,
    links: s.links.length,
  };
}

export interface Change {
  field: keyof Omit<PageDigest, 'at'>;
  before: string;
  after: string;
}

export function diffDigests(before: PageDigest, after: PageDigest): Change[] {
  const changes: Change[] = [];
  for (const field of Object.keys(after) as (keyof PageDigest)[]) {
    if (field === 'at') continue;
    // 0 means the navigation was not recorded, not a status change.
    if (field === 'status' && (!before.status || !after.status)) continue;
    const a = before[field];
    const b = after[field];
    if (field === 'words' || field === 'links') {
      // Small counts drift with ads and rotating widgets; report only real changes.
      if (Math.abs(Number(a) - Number(b)) <= Math.max(20, Number(a) * 0.1)) continue;
    } else if (a === b) continue;
    changes.push({ field, before: String(a), after: String(b) });
  }
  return changes;
}
