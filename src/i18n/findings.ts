import type { Finding } from '../lib/types';

// Every check result the analysers can produce, in English. Checks return ids and params only,
// so a translation is one more object of this shape.

type P = Record<string, string | number>;
type Msg = (p: P) => string;

const plural = (n: string | number, one: string, many = `${one}s`) =>
  `${n} ${Number(n) === 1 ? one : many}`;

export const FINDINGS: Record<string, Msg> = {
  'title.missing': () => 'No title tag',
  'title.short': (p) => `Title is short (${p.n} characters, aim for 30–60)`,
  'title.long': (p) => `Title is long (${p.n} characters, aim for 30–60)`,
  'title.ok': (p) => `Title length is good (${p.n} characters)`,
  'description.missing': () => 'No meta description',
  'description.short': (p) => `Meta description is short (${p.n} characters, aim for 70–160)`,
  'description.long': (p) => `Meta description is long (${p.n} characters, aim for 70–160)`,
  'description.ok': (p) => `Meta description length is good (${p.n} characters)`,
  'h1.missing': () => 'No H1 heading',
  'h1.multiple': (p) => `${p.n} H1 headings – one is clearer`,
  'h1.empty': () => 'The H1 heading is empty',
  'heading.skip': (p) => `Heading level skipped: H${p.from} → H${p.to}`,
  'lang.missing': () => 'No lang attribute on <html>',
  'viewport.missing': () => 'No viewport meta tag – the page is not mobile-friendly',
  'content.thin': (p) => `Thin content: ${plural(p.n, 'word')}`,

  'index.ok': () => 'Indexable',
  'index.status': (p) => `HTTP ${p.status} – not indexable`,
  'index.redirected': (p) => `The URL redirects (${p.status})`,
  'index.noindexMeta': () => 'Meta robots says noindex',
  'index.noindexHeader': () => 'X-Robots-Tag header says noindex',
  'index.nofollow': () => 'Nofollow on this page: its links pass no signals',
  'index.robotsBlocked': (p) => `Blocked for Googlebot by robots.txt (${p.rule})`,
  'canonical.multiple': (p) => `${p.n} different canonical URLs – Google may ignore them all`,
  'canonical.other': (p) => `Canonical points to another URL: ${p.url}`,
  'canonical.clean': (p) =>
    `This address only adds tracking parameters; the canonical ${p.url} is the version Google indexes`,
  'canonical.missing': () => 'No canonical URL',

  'links.emptyText': (p) => `${plural(p.n, 'link')} without text`,
  'links.internalNofollow': (p) => `${plural(p.n, 'internal link')} with nofollow`,
  'links.insecure': (p) => `${plural(p.n, 'link')} to http:// URLs`,

  'img.altMissing': (p) => `${plural(p.n, 'image')} without an alt attribute`,
  'img.noDimensions': (p) => `${plural(p.n, 'image')} without width and height (layout shift risk)`,
  'img.oversized': (p) => `${plural(p.n, 'image')} much larger than displayed`,
  'img.legacyFormat': (p) => `${plural(p.n, 'image')} could use WebP or AVIF`,
  'img.lazyAboveFold': (p) => `${plural(p.n, 'image')} above the fold lazy-loaded (slows LCP)`,
  'img.notLazy': (p) => `${plural(p.n, 'image')} below the fold not lazy-loaded`,

  'schema.parseError': (p) => `${plural(p.n, 'JSON-LD block')} could not be parsed`,
  'schema.none': () => 'No structured data',
  'schema.requiredMissing': (p) => `${plural(p.n, 'item')} missing a required property`,
  'schema.recommendedMissing': (p) =>
    `${plural(p.n, 'recommended property', 'recommended properties')} missing`,

  'social.missing': (p) => `${p.tag} missing`,
  'social.imageRelative': () => 'Relative og:image URL – most networks need an absolute one',

  'hreflang.invalid': (p) => `Invalid hreflang code: ${p.code}`,
  'hreflang.duplicate': (p) => `Duplicate hreflang: ${p.code} points to different URLs`,
  'hreflang.noSelf': () => 'No hreflang entry for this page itself',
  'hreflang.noDefault': () => 'No x-default hreflang',

  'hdr.ok': () => 'Set',
  'hdr.notHttps': () => 'Page is not served over HTTPS',
  'hdr.hstsMissing': () => 'No Strict-Transport-Security header',
  'hdr.hstsShort': () => 'HSTS max-age is under 6 months',
  'hdr.cspMissing': () => 'No Content-Security-Policy',
  'hdr.xfoViaCsp': () => 'Framing controlled by CSP frame-ancestors',
  'hdr.xfoMissing': () => 'No X-Frame-Options or frame-ancestors (clickjacking)',
  'hdr.nosniffMissing': () => 'No X-Content-Type-Options: nosniff',
  'hdr.referrerDefault': () => 'No Referrer-Policy (browser default applies)',
  'hdr.permissionsMissing': () => 'No Permissions-Policy',
  'hdr.uncompressed': () => 'HTML served without compression',
  'hdr.compressed': (p) => `Compressed with ${p.encoding}`,
  'hdr.noCacheControl': () => 'No Cache-Control header on the HTML',
  'hdr.publicWithCookie': () => 'Cache-Control: public on a response that sets cookies',
  'hdr.varyUserAgent': () => 'Vary: User-Agent lowers CDN cache hits',

  'redirect.chain': (p) => `Redirect chain of ${p.n} hops – link to the final URL`,
  'redirect.temporary': (p) => `${p.status} temporary redirect from ${p.url}`,
  'redirect.loop': () => 'Redirect loop',
  'redirect.httpToHttps': () => 'HTTP → HTTPS redirect',
  'redirect.client': () => 'Client-side redirect (meta refresh or JavaScript)',

  'res.renderBlocking': (p) => `${plural(p.n, 'render-blocking resource')}`,
  'res.uncompressed': (p) => `${plural(p.n, 'text file')} served uncompressed`,
  'res.thirdPartyHeavy': (p) => `Third parties are ${p.share}% of the bytes`,

  'track.beforeConsent': (p) =>
    `${plural(p.trackers, 'tracker')} and ${plural(p.cookies, 'cookie')} before consent`,
  'track.noCmp': () => 'Marketing tags load but no consent banner was detected',
  'track.noConsentMode': () => 'Google tags without Consent Mode',
  'track.consentKeyMissing': (p) => `Consent Mode default for ${p.key} is not set`,
  'track.insecureCookies': (p) => `${plural(p.n, 'cookie')} without the Secure flag`,

  'raw.changedByJs': (p) => `JavaScript changes the ${p.field}`,
  'raw.h1OnlyRendered': () => 'The H1 only appears after JavaScript runs',
  'raw.contentByJs': (p) =>
    `Most content needs JavaScript (${p.raw} words raw, ${p.rendered} rendered)`,
  'raw.linksByJs': (p) => `Most links need JavaScript (${p.raw} raw, ${p.rendered} rendered)`,

  'ai.llmsTxt': (p) =>
    `llms.txt found · ${Math.round(Number(p.bytes) / 102.4) / 10} KB · ${plural(p.links, 'link')}`,
  'ai.llmsTxtMissing': () => 'No /llms.txt',
  'ai.crawlersBlocked': (p) => `${p.bots} blocked in robots.txt`,
  'ai.crawlersAllowed': () => 'AI crawlers allowed by robots.txt',
  'ai.rawUnknown': () => 'Raw HTML could not be read',
  'ai.needsJs': (p) =>
    `Main content needs JavaScript (${p.raw} of ${p.rendered} words in raw HTML); most AI crawlers do not render`,
  'ai.noJsNeeded': () => 'Main content is in the raw HTML',
  'ai.structured': (p) => `Structured data: ${p.types}`,
  'ai.noStructured': () => 'No structured data',
  'ai.semantic': (p) => `Semantic HTML: ${p.tags}`,
  'ai.noMain': () => 'No <main> element',
  'ai.authorDates': () => 'Author and dates marked up',
  'ai.authorDatesMissing': () => 'Author or modified date not marked up',
  'ai.markdown': () => 'A Markdown version is available',
  'ai.noMarkdown': () => 'No Markdown version (.md URL or text/markdown)',
  'ai.inSitemap': () => 'Listed in the sitemap',
  'ai.notInSitemap': () => 'Not listed in the sitemap',
  'ai.noaiSet': () => 'AI opt-out set: noai / noimageai',
  'ai.noaiNotSet': () => 'No noai / noimageai',
  'ai.size': (p) => `${plural(p.words, 'word')} of content, ${p.kb} KB HTML`,
};

export function message(f: Pick<Finding, 'id' | 'params'>): string {
  return FINDINGS[f.id]?.(f.params ?? {}) ?? f.id;
}
