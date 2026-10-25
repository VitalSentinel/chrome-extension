import type { Finding, PageSnapshot } from '../types';
import { normalizeUrl } from '../url';

// BCP 47 subset Google accepts: ISO 639-1 language, optional script, optional ISO 3166-1
// region, or x-default. Common mistakes it catches: "en-UK", "en_GB", "en-gb-x".
const CODE = /^([a-z]{2,3})(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/i;
const BAD_REGIONS = new Set(['UK', 'EU']);

export function hreflangFindings(s: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  if (!s.hreflang.length) return out;
  const seen = new Map<string, string>();
  for (const { lang, href } of s.hreflang) {
    const code = lang.trim();
    if (code.toLowerCase() !== 'x-default') {
      const m = CODE.exec(code);
      if (!m || BAD_REGIONS.has((m[4] ?? '').toUpperCase()))
        out.push({ id: 'hreflang.invalid', level: 'bad', params: { code } });
    }
    const key = code.toLowerCase();
    if (seen.has(key) && seen.get(key) !== href)
      out.push({ id: 'hreflang.duplicate', level: 'bad', params: { code } });
    seen.set(key, href);
  }
  if (!s.hreflang.some((h) => normalizeUrl(h.href) === normalizeUrl(s.url))) {
    out.push({ id: 'hreflang.noSelf', level: 'warn' });
  }
  if (!seen.has('x-default')) out.push({ id: 'hreflang.noDefault', level: 'info' });
  return out;
}
