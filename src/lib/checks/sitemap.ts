// Sitemap reading without DOMParser (the service worker has none): <loc> extraction is enough
// to tell an index from a urlset and whether the page is listed. Regular expressions rather
// than an XML parser, so a malformed file still yields what can be read from it.

export interface Sitemap {
  kind: 'index' | 'urlset' | 'unknown';
  locs: string[];
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

// One pass, so `&amp;lt;` stays `&lt;` instead of being decoded twice.
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:(lt|gt|quot|apos|amp)|#(\d+)|#x([\da-f]+));/gi, (m, name, dec, hex) => {
      if (name) return ENTITIES[name.toLowerCase()];
      const code = dec ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .trim();

/** The root element's name, without a namespace prefix, and the prefix (`sm:` or ''). */
function root(xml: string): { name: string; prefix: string } | null {
  // Skips the XML declaration, comments, processing instructions and a doctype.
  const head = xml.slice(0, 8192).replace(/<!--[\s\S]*?(-->|$)/g, '');
  const m = /<(?![?!])([\w.-]+:)?([\w.-]+)[\s/>]/.exec(head);
  return m ? { name: m[2].toLowerCase(), prefix: m[1] ?? '' } : null;
}

/**
 * Reads a sitemap index, a urlset or a plain-text sitemap (one URL per line). The kind comes
 * from the root element, else from the children: some sites wrap <url> entries in a root
 * named <sitemap>, which Google still reads.
 */
export function parseSitemap(body: string): Sitemap {
  const text = body.replace(/^﻿/, '');
  if (!/</.test(text)) {
    const locs = text
      .split(/\r\n|\r|\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\/\S+$/i.test(l));
    return { kind: locs.length ? 'urlset' : 'unknown', locs };
  }
  const r = root(text);
  // Some generators use a <sitemap> root around <url> entries; any other root (html, rss) is not
  // a sitemap, even if it holds a <url> element.
  if (!r || !['urlset', 'sitemapindex', 'sitemap'].includes(r.name))
    return { kind: 'unknown', locs: [] };
  const p = r.prefix.replace(/[.]/g, '\\.');
  const has = (tag: string) => new RegExp(`<${p}${tag}[\\s>]`, 'i').test(text);
  const kind =
    r.name === 'sitemapindex'
      ? 'index'
      : r.name === 'urlset' || has('url')
        ? 'urlset'
        : has('sitemap')
          ? 'index'
          : 'unknown';
  if (kind === 'unknown') return { kind, locs: [] };
  // Only <loc> in the root's namespace: image:loc and video:loc are not pages.
  const locs: string[] = [];
  for (const m of text.matchAll(new RegExp(`<${p}loc\\s*>([\\s\\S]*?)</${p}loc\\s*>`, 'gi'))) {
    const loc = decode(m[1]);
    if (loc) locs.push(loc);
  }
  return { kind, locs };
}

/** Same URL ignoring a trailing slash difference and the fragment. */
export function sameUrl(a: string, b: string): boolean {
  return normal(a) === normal(b);
}

function normal(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href.replace(/\/$/, '');
  } catch {
    return u;
  }
}

/**
 * Whether any of `locs` is `pageUrl`. A cheap substring test on the path skips the URL parse
 * for almost every entry, which matters for 50,000-URL files.
 */
export function listsUrl(locs: string[], pageUrl: string): boolean {
  const target = normal(pageUrl);
  let path: string;
  try {
    path = new URL(target).pathname.replace(/\/$/, '');
  } catch {
    return locs.some((l) => sameUrl(l, pageUrl));
  }
  // Locs may percent-encode differently; the last path segment is a safe filter either way.
  const tail = decodeSafe(path.slice(path.lastIndexOf('/') + 1));
  return locs.some((l) => (!tail || decodeSafe(l).includes(tail)) && normal(l) === target);
}

function decodeSafe(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

export function defaultSitemaps(origin: string): string[] {
  return [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
}
