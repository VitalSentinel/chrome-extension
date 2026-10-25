// URL helpers that need no public suffix list. The app normalises to the registrable domain
// for DR; the extension only needs "same site" for internal links and a cache key.

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'or', 'ne', 'go']);

// Hosting platforms where every subdomain is someone else's site.
const SHARED = new Set([
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'appspot.com',
  'azurewebsites.net',
  'cloudfront.net',
  'onrender.com',
  'fly.dev',
  'blogspot.com',
  'wordpress.com',
  'wixsite.com',
  'myshopify.com',
]);

export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** Best-effort registrable domain: last two labels, three for ccTLD second levels (co.uk). */
export function siteOf(host: string): string {
  const labels = stripWww(host).split('.');
  if (labels.length <= 2) return labels.join('.');
  const take =
    (labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!)) ||
    SHARED.has(labels.slice(-2).join('.'))
      ? 3
      : 2;
  return labels.slice(-take).join('.');
}

export function isWebUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/** Hosts the DR endpoint refuses: IPs, localhost, single-label names. */
export function isPublicHost(host: string): boolean {
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith('[')) return false;
  // Reserved and common private-network suffixes never leave the browser.
  return !/\.(local|localdomain|internal|intranet|lan|corp|home|private|test|example|invalid|home\.arpa)$/i.test(
    host,
  );
}

export function sameSite(a: string, b: string): boolean {
  try {
    return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname);
  } catch {
    return false;
  }
}

/** Same exact host, the rule for what offline mode may contact. */
export function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

/** URL without hash, for comparing canonicals and sitemap entries. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

// Parameters that only say where a visit came from. Google folds them into the clean URL, so
// a canonical without them still means the page itself is indexed.
const TRACKING = new Set([
  'gclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'li_fat_id',
  'srsltid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  's_kwcid',
  'ef_id',
  'irclickid',
  'epik',
  'rb_clickid',
]);
const isTracking = (name: string) => {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || n.startsWith('hsa_') || TRACKING.has(n);
};

/**
 * The URL without its hash and tracking parameters. Every other parameter keeps its order and
 * its exact spelling (`%20` stays `%20`, `?a` stays `?a`), so the app sees the address Google does.
 */
export function withoutTracking(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const parts = u.search.slice(1).split('&').filter(Boolean);
    const name = (part: string) => {
      const raw = part.split('=')[0];
      try {
        return decodeURIComponent(raw.replace(/\+/g, ' '));
      } catch {
        return raw;
      }
    };
    const kept = parts.filter((p) => !isTracking(name(p)));
    if (kept.length !== parts.length) u.search = kept.length ? `?${kept.join('&')}` : '';
    return u.href;
  } catch {
    return url;
  }
}
