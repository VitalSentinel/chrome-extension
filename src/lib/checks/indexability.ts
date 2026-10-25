import type { Finding, NavRecord, PageSnapshot } from '../types';
import { normalizeUrl, withoutTracking } from '../url';
import { metaValues } from './content';
import { isAllowed, type RobotsTxt } from './robots';

export const header = (nav: Pick<NavRecord, 'headers'> | null | undefined, name: string) =>
  nav?.headers.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v) ?? [];

/** Robots directives from meta robots, meta googlebot and X-Robots-Tag (agent-less or googlebot). */
export function robotsDirectives(s: PageSnapshot, nav: NavRecord | null): Set<string> {
  const values = [
    ...metaValues(s, 'robots'),
    ...metaValues(s, 'googlebot'),
    ...header(nav, 'x-robots-tag')
      .flatMap((v) => v.split(/,(?=\s*[a-z-]+\s*:)/i))
      .map((v) => {
        const m = /^\s*([a-z-]+)\s*:\s*(.*)$/i.exec(v);
        if (!m) return v;
        const key = m[1].toLowerCase();
        if (['googlebot', 'all'].includes(key)) return m[2];
        // "max-snippet: 50" is a directive; "bingbot: noindex" is for another crawler.
        return /^(noindex|nofollow|none|noarchive|nosnippet|max-|unavailable_after|noimageindex|notranslate|indexifembedded)/i.test(
          key,
        )
          ? v
          : '';
      }),
  ];
  const set = new Set<string>();
  for (const v of values)
    for (const d of v.toLowerCase().split(',')) if (d.trim()) set.add(d.trim());
  if (set.has('none')) set.add('noindex').add('nofollow');
  return set;
}

export interface Indexability {
  indexable: boolean;
  findings: Finding[];
  canonical: string | null;
  canonicalSelf: boolean | null;
  // The canonical is this page without its tracking parameters: Google indexes that URL.
  canonicalClean: boolean;
}

export function indexability(
  s: PageSnapshot,
  nav: NavRecord | null,
  robots: RobotsTxt | null,
): Indexability {
  const findings: Finding[] = [];
  let indexable = true;
  // Without a recorded response, the page's own Navigation Timing status (Chrome 109+).
  const status = nav?.status || s.status || 0;
  if (status >= 400) {
    indexable = false;
    findings.push({ id: 'index.status', level: 'bad', params: { status } });
  } else if (status >= 300) {
    findings.push({ id: 'index.redirected', level: 'warn', params: { status } });
  }

  const directives = robotsDirectives(s, nav);
  if (directives.has('noindex')) {
    indexable = false;
    const fromHeader = header(nav, 'x-robots-tag').some((v) => /noindex|none/i.test(v));
    findings.push({ id: fromHeader ? 'index.noindexHeader' : 'index.noindexMeta', level: 'bad' });
  }
  if (directives.has('nofollow')) findings.push({ id: 'index.nofollow', level: 'warn' });

  if (robots) {
    const verdict = isAllowed(robots, 'Googlebot', s.url);
    if (!verdict.allowed) {
      indexable = false;
      findings.push({
        id: 'index.robotsBlocked',
        level: 'bad',
        params: { rule: verdict.rule!.path },
      });
    }
  }

  const canonicals = [...new Set([...s.canonicals, ...linkHeaderCanonicals(nav, s.url)])];
  let canonical: string | null = null;
  let canonicalSelf: boolean | null = null;
  let canonicalClean = false;
  if (canonicals.length > 1) {
    findings.push({ id: 'canonical.multiple', level: 'bad', params: { n: canonicals.length } });
  }
  if (canonicals.length) {
    canonical = canonicals[0];
    canonicalSelf = normalizeUrl(canonical) === normalizeUrl(s.url);
    canonicalClean = !canonicalSelf && withoutTracking(canonical) === withoutTracking(s.url);
    if (canonicalClean) {
      findings.push({ id: 'canonical.clean', level: 'info', params: { url: canonical } });
    } else if (!canonicalSelf) {
      indexable = false;
      findings.push({ id: 'canonical.other', level: 'warn', params: { url: canonical } });
    }
  } else {
    findings.push({ id: 'canonical.missing', level: 'warn' });
  }
  if (indexable) findings.unshift({ id: 'index.ok', level: 'good' });
  return { indexable, findings, canonical, canonicalSelf, canonicalClean };
}

/** rel=canonical sent in a Link response header. */
export function linkHeaderCanonicals(nav: NavRecord | null, base: string): string[] {
  const out: string[] = [];
  for (const value of header(nav, 'link')) {
    for (const part of value.split(/,(?=\s*<)/)) {
      const m = /<([^>]+)>\s*;(.*)/.exec(part);
      if (m && /rel\s*=\s*"?canonical"?/i.test(m[2])) out.push(new URL(m[1], base).href);
    }
  }
  return out;
}
