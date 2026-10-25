import type { NavRecord, PageSnapshot } from '../types';
import { metaValue } from './content';
import { header } from './indexability';

// Our own small fingerprint set (no GPL data): each technology is matched on response headers,
// meta generator, script/stylesheet URLs, cookie names or page globals. Extend by adding rows.

export type TechCategory =
  | 'cms'
  | 'server'
  | 'framework'
  | 'analytics'
  | 'tags'
  | 'ads'
  | 'cmp'
  | 'library'
  | 'ecommerce'
  | 'fonts';

interface Fingerprint {
  name: string;
  category: TechCategory;
  header?: [string, RegExp];
  generator?: RegExp;
  src?: RegExp;
  cookie?: RegExp;
  global?: string;
  version?: RegExp; // applied to the matched header, generator or src
}

export const FINGERPRINTS: Fingerprint[] = [
  {
    name: 'WordPress',
    category: 'cms',
    generator: /wordpress ?([\d.]+)?/i,
    src: /\/wp-(content|includes)\//,
    version: /wordpress ?([\d.]+)|ver=([\d.]+)/i,
  },
  {
    name: 'Shopify',
    category: 'ecommerce',
    header: ['x-shopid', /./],
    src: /cdn\.shopify\.com/,
    global: 'Shopify',
  },
  { name: 'WooCommerce', category: 'ecommerce', src: /woocommerce/i, cookie: /^woocommerce_/ },
  { name: 'Wix', category: 'cms', generator: /wix\.com/i, header: ['x-wix-request-id', /./] },
  {
    name: 'Squarespace',
    category: 'cms',
    generator: /squarespace/i,
    src: /static1\.squarespace\.com/,
  },
  { name: 'Webflow', category: 'cms', generator: /webflow/i, src: /webflow\.(com|io)/ },
  {
    name: 'Drupal',
    category: 'cms',
    generator: /drupal ?([\d.]+)?/i,
    header: ['x-generator', /drupal/i],
  },
  { name: 'Joomla', category: 'cms', generator: /joomla/i },
  { name: 'Ghost', category: 'cms', generator: /ghost ?([\d.]+)?/i },
  { name: 'HubSpot CMS', category: 'cms', header: ['x-hs-hub-id', /./] },
  {
    name: 'Magento',
    category: 'ecommerce',
    cookie: /^(frontend|mage-cache-sessid)$/,
    src: /\/static\/version\d+\/frontend\//,
  },
  { name: 'PrestaShop', category: 'ecommerce', generator: /prestashop/i },
  { name: 'Yoast SEO', category: 'cms', src: /wp-content\/plugins\/wordpress-seo/ },
  {
    name: 'Next.js',
    category: 'framework',
    header: ['x-powered-by', /next\.js/i],
    src: /\/_next\/static\//,
    global: '__NEXT_DATA__',
  },
  { name: 'Nuxt', category: 'framework', src: /\/_nuxt\//, global: '__NUXT__' },
  { name: 'Gatsby', category: 'framework', generator: /gatsby ?([\d.]+)?/i, global: '___gatsby' },
  { name: 'Astro', category: 'framework', generator: /astro v?([\d.]+)?/i },
  { name: 'React', category: 'library', global: '__REACT_DEVTOOLS_GLOBAL_HOOK__' },
  { name: 'Vue.js', category: 'library', global: '__VUE__' },
  { name: 'Angular', category: 'framework', global: 'ng' },
  { name: 'Svelte', category: 'library', src: /svelte/i },
  {
    name: 'jQuery',
    category: 'library',
    src: /jquery[.-]?([\d.]+)?(\.min)?\.js/i,
    global: 'jQuery',
    version: /jquery[.-](\d+(?:\.\d+)*)/i,
  },
  { name: 'Bootstrap', category: 'library', src: /bootstrap(\.bundle)?(\.min)?\.(js|css)/i },
  { name: 'Tailwind CSS', category: 'library', src: /tailwind/i },
  { name: 'Cloudflare', category: 'server', header: ['server', /cloudflare/i] },
  { name: 'Fastly', category: 'server', header: ['x-served-by', /cache-/i] },
  { name: 'Akamai', category: 'server', header: ['server', /akamai/i] },
  { name: 'Amazon CloudFront', category: 'server', header: ['x-amz-cf-id', /./] },
  { name: 'Vercel', category: 'server', header: ['x-vercel-id', /./] },
  { name: 'Netlify', category: 'server', header: ['x-nf-request-id', /./] },
  { name: 'nginx', category: 'server', header: ['server', /nginx\/?([\d.]+)?/i] },
  { name: 'Apache', category: 'server', header: ['server', /apache\/?([\d.]+)?/i] },
  { name: 'LiteSpeed', category: 'server', header: ['server', /litespeed/i] },
  { name: 'IIS', category: 'server', header: ['server', /microsoft-iis\/?([\d.]+)?/i] },
  { name: 'PHP', category: 'server', header: ['x-powered-by', /php\/?([\d.]+)?/i] },
  { name: 'ASP.NET', category: 'server', header: ['x-powered-by', /asp\.net/i] },
  {
    name: 'Google Tag Manager',
    category: 'tags',
    src: /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/,
    version: /id=(GTM-[A-Z0-9]+)/,
  },
  {
    name: 'Google Analytics 4',
    category: 'analytics',
    src: /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/,
    cookie: /^_ga_/,
    version: /id=(G-[A-Z0-9]+)/,
  },
  {
    name: 'Google Ads',
    category: 'ads',
    src: /googleadservices\.com|googletagmanager\.com\/gtag\/js\?id=AW-/,
  },
  {
    name: 'Meta Pixel',
    category: 'ads',
    src: /connect\.facebook\.net\/.*fbevents\.js/,
    cookie: /^_fbp$/,
  },
  { name: 'LinkedIn Insight', category: 'ads', src: /snap\.licdn\.com/ },
  { name: 'TikTok Pixel', category: 'ads', src: /analytics\.tiktok\.com/ },
  { name: 'Microsoft Clarity', category: 'analytics', src: /clarity\.ms/ },
  { name: 'Hotjar', category: 'analytics', src: /static\.hotjar\.com/, cookie: /^_hj/ },
  { name: 'Matomo', category: 'analytics', src: /matomo\.js|piwik\.js/, cookie: /^_pk_/ },
  { name: 'Plausible', category: 'analytics', src: /plausible\.io\/js/ },
  { name: 'Fathom', category: 'analytics', src: /cdn\.usefathom\.com/ },
  { name: 'VitalSentinel', category: 'analytics', src: /vitalsentinel\.com/ },
  { name: 'Segment', category: 'analytics', src: /cdn\.segment\.com/ },
  {
    name: 'HubSpot',
    category: 'analytics',
    src: /js\.hs-scripts\.com|js\.hsforms\.net/,
    cookie: /^hubspotutk$/,
  },
  { name: 'Intercom', category: 'library', src: /widget\.intercom\.io/ },
  { name: 'Google AdSense', category: 'ads', src: /pagead2\.googlesyndication\.com/ },
  { name: 'Google Fonts', category: 'fonts', src: /fonts\.(googleapis|gstatic)\.com/ },
  { name: 'Adobe Fonts', category: 'fonts', src: /use\.typekit\.net/ },
  {
    name: 'OneTrust',
    category: 'cmp',
    src: /cdn\.cookielaw\.org|optanon/i,
    cookie: /^OptanonConsent$/,
  },
  { name: 'Cookiebot', category: 'cmp', src: /consent\.cookiebot\.com/, cookie: /^CookieConsent$/ },
  { name: 'Didomi', category: 'cmp', src: /sdk\.privacy-center\.org/, cookie: /^didomi_token$/ },
  { name: 'Usercentrics', category: 'cmp', src: /usercentrics\.eu/ },
  { name: 'CookieYes', category: 'cmp', src: /cdn-cookieyes\.com/, cookie: /^cookieyes-consent$/ },
  { name: 'Complianz', category: 'cmp', src: /complianz/i, cookie: /^cmplz_/ },
  { name: 'iubenda', category: 'cmp', src: /cdn\.iubenda\.com/ },
  {
    name: 'Quantcast Choice',
    category: 'cmp',
    src: /quantcast\.mgr\.consensu\.org|cmp\.quantcast\.com/,
  },
];

export interface DetectedTech {
  name: string;
  category: TechCategory;
  version: string;
}

export interface TechInput {
  snapshot: Pick<PageSnapshot, 'meta' | 'scripts' | 'stylesheets' | 'resources'>;
  nav: Pick<NavRecord, 'headers'> | null;
  cookies: string[];
  globals: string[];
}

export function detectTech({ snapshot, nav, cookies, globals }: TechInput): DetectedTech[] {
  const generator = metaValue(snapshot as PageSnapshot, 'generator') ?? '';
  const urls = [
    ...snapshot.scripts,
    ...snapshot.stylesheets,
    ...snapshot.resources.map((r) => r.url),
  ];
  const found: DetectedTech[] = [];
  for (const fp of FINGERPRINTS) {
    let evidence: string | null = null;
    if (fp.header) evidence = header(nav, fp.header[0]).find((v) => fp.header![1].test(v)) ?? null;
    if (!evidence && fp.generator && fp.generator.test(generator)) evidence = generator;
    if (!evidence && fp.src) evidence = urls.find((u) => fp.src!.test(u)) ?? null;
    if (!evidence && fp.cookie) evidence = cookies.find((c) => fp.cookie!.test(c)) ?? null;
    if (!evidence && fp.global && globals.includes(fp.global)) evidence = fp.global;
    if (evidence === null) continue;
    const m = (fp.version ?? fp.generator ?? fp.header?.[1] ?? fp.src)?.exec(evidence);
    const version = m ? (m.slice(1).find((g) => g && /\d|^G-|^GTM-/.test(g)) ?? '') : '';
    found.push({ name: fp.name, category: fp.category, version });
  }
  return found;
}

/** Page globals the MAIN-world probe checks for; the probe only reports which exist. */
export const PROBE_GLOBALS = [
  ...new Set(FINGERPRINTS.flatMap((f) => (f.global ? [f.global] : []))),
];
