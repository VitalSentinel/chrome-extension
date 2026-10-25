import type { Finding, RequestInfo, ResourceInfo } from '../types';

// Tracker and cookie classification for the consent scan. Hosts and cookie names are our own
// short list of the most common vendors; anything else third-party counts as "other".

export type Purpose = 'marketing' | 'analytics' | 'necessary' | 'functional' | 'unknown';

const TRACKER_HOSTS: [RegExp, string, Purpose][] = [
  [/(^|\.)google-analytics\.com$/, 'Google Analytics', 'analytics'],
  [/(^|\.)analytics\.google\.com$/, 'Google Analytics', 'analytics'],
  [/(^|\.)googletagmanager\.com$/, 'Google Tag Manager', 'analytics'],
  [
    /(^|\.)(doubleclick\.net|googleadservices\.com|googlesyndication\.com)$/,
    'Google Ads',
    'marketing',
  ],
  [/(^|\.)(facebook\.net|facebook\.com)$/, 'Meta', 'marketing'],
  [/(^|\.)(licdn\.com|linkedin\.com)$/, 'LinkedIn', 'marketing'],
  [/(^|\.)(tiktok\.com|tiktokw\.us)$/, 'TikTok', 'marketing'],
  [/(^|\.)(bing\.com|bat\.bing\.com)$/, 'Microsoft Ads', 'marketing'],
  [/(^|\.)clarity\.ms$/, 'Microsoft Clarity', 'analytics'],
  [/(^|\.)hotjar\.(com|io)$/, 'Hotjar', 'analytics'],
  [/(^|\.)(twitter\.com|ads-twitter\.com|t\.co)$/, 'X (Twitter)', 'marketing'],
  [/(^|\.)pinimg\.com$|(^|\.)pinterest\.com$/, 'Pinterest', 'marketing'],
  [/(^|\.)criteo\.(com|net)$/, 'Criteo', 'marketing'],
  [/(^|\.)taboola\.com$/, 'Taboola', 'marketing'],
  [/(^|\.)outbrain\.com$/, 'Outbrain', 'marketing'],
  [/(^|\.)hs-(scripts|analytics|banner)\.(com|net)$/, 'HubSpot', 'marketing'],
  [/(^|\.)segment\.(com|io)$/, 'Segment', 'analytics'],
  [/(^|\.)mixpanel\.com$/, 'Mixpanel', 'analytics'],
  [/(^|\.)amplitude\.com$/, 'Amplitude', 'analytics'],
  [/(^|\.)snapchat\.com$|(^|\.)sc-static\.net$/, 'Snap', 'marketing'],
  [/(^|\.)reddit\.com$|(^|\.)redditstatic\.com$/, 'Reddit', 'marketing'],
  [/(^|\.)yandex\.(ru|com)$|(^|\.)mc\.yandex/, 'Yandex Metrica', 'analytics'],
];

const COOKIE_PURPOSES: [RegExp, Purpose][] = [
  [/^(_ga|_ga_.*|_gid|_gat.*|_hj.*|_clck|_clsk|_pk_.*|ajs_.*|amplitude_.*|mp_.*)$/, 'analytics'],
  [
    /^(_fbp|_fbc|_gcl_.*|_uetsid|_uetvid|_ttp|_pin_unauth|_scid|IDE|test_cookie|li_.*|bcookie|lidc|_rdt_uuid|muid|MUID)$/i,
    'marketing',
  ],
  [
    /^(OptanonConsent|OptanonAlertBoxClosed|CookieConsent|cookieyes-consent|cmplz_.*|didomi_token|euconsent-v2|cookie_consent|cookielawinfo.*|usercentrics.*|uc_.*)$/i,
    'necessary',
  ],
  [
    /^(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|wordpress_.*|wp-settings.*|csrftoken|XSRF-TOKEN|__cf_bm|cf_clearance|__Host-.*|__Secure-.*)$/i,
    'necessary',
  ],
];

/** The page's own resource timeline as request rows (the worker does not watch subresources). */
export function requestsFrom(resources: ResourceInfo[]): RequestInfo[] {
  return resources.flatMap((r) => {
    try {
      const host = new URL(r.url).hostname;
      return [
        {
          url: r.url,
          host,
          type: r.type,
          status: 200,
          t: r.start,
          encoding: '',
          cacheControl: '',
          size: r.transferSize,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function trackerFor(host: string): { vendor: string; purpose: Purpose } | null {
  const hit = TRACKER_HOSTS.find(([re]) => re.test(host));
  return hit ? { vendor: hit[1], purpose: hit[2] } : null;
}

export function cookiePurpose(name: string): Purpose {
  return COOKIE_PURPOSES.find(([re]) => re.test(name))?.[1] ?? 'unknown';
}

const CONSENT_COOKIES =
  /^(OptanonConsent|CookieConsent|cookieyes-consent|cmplz_consent.*|didomi_token|euconsent-v2|uc_settings|cookie_consent)$/i;

export interface CookieRow {
  name: string;
  domain: string;
  purpose: Purpose;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  session: boolean;
  expires: number | null; // epoch seconds
}

export interface ConsentMode {
  defaults: Record<string, string>;
  updates: Record<string, string>;
}

export interface TrackingScan {
  trackers: { vendor: string; purpose: Purpose; requests: number }[];
  consentStored: boolean;
  consentMode: ConsentMode | null;
  beforeConsent: { trackers: number; cookies: number } | null;
  findings: Finding[];
}

export function scanTracking(
  requests: RequestInfo[],
  cookies: CookieRow[],
  consentMode: ConsentMode | null,
  cmpPresent: boolean,
): TrackingScan {
  const byVendor = new Map<string, { vendor: string; purpose: Purpose; requests: number }>();
  for (const r of requests) {
    const t = trackerFor(r.host);
    if (!t) continue;
    const row = byVendor.get(t.vendor) ?? { ...t, requests: 0 };
    row.requests += 1;
    byVendor.set(t.vendor, row);
  }
  const trackers = [...byVendor.values()].sort((a, b) => b.requests - a.requests);
  const consentStored = cookies.some((c) => CONSENT_COOKIES.test(c.name));
  // With a consent banner on screen and no stored choice, everything already loaded ran before consent.
  const nonEssential = cookies.filter(
    (c) => c.purpose === 'marketing' || c.purpose === 'analytics',
  );
  const beforeConsent =
    cmpPresent && !consentStored
      ? {
          trackers: trackers.filter((t) => t.purpose === 'marketing' || t.purpose === 'analytics')
            .length,
          cookies: nonEssential.length,
        }
      : null;

  const findings: Finding[] = [];
  if (beforeConsent && (beforeConsent.trackers || beforeConsent.cookies)) {
    findings.push({
      id: 'track.beforeConsent',
      level: 'bad',
      params: { trackers: beforeConsent.trackers, cookies: beforeConsent.cookies },
    });
  }
  if (!cmpPresent && trackers.some((t) => t.purpose === 'marketing'))
    findings.push({ id: 'track.noCmp', level: 'warn' });
  if (trackers.some((t) => t.vendor.startsWith('Google')) && !consentMode)
    findings.push({ id: 'track.noConsentMode', level: 'warn' });
  if (consentMode) {
    for (const key of ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']) {
      if (!consentMode.defaults[key])
        findings.push({ id: 'track.consentKeyMissing', level: 'warn', params: { key } });
    }
  }
  const insecure = cookies.filter((c) => !c.secure && c.purpose !== 'unknown').length;
  if (insecure)
    findings.push({ id: 'track.insecureCookies', level: 'info', params: { n: insecure } });
  return { trackers, consentStored, consentMode, beforeConsent, findings };
}

/** Reads gtag consent commands from a dataLayer copy (arguments objects become arrays). */
export function readConsentMode(dataLayer: unknown[]): ConsentMode | null {
  const defaults: Record<string, string> = {};
  const updates: Record<string, string> = {};
  let seen = false;
  for (const entry of dataLayer) {
    const args = Array.isArray(entry)
      ? entry
      : entry && typeof entry === 'object'
        ? Object.values(entry as object)
        : [];
    if (args[0] !== 'consent' || !args[2] || typeof args[2] !== 'object') continue;
    seen = true;
    const target = args[1] === 'default' ? defaults : args[1] === 'update' ? updates : null;
    if (!target) continue;
    for (const [k, v] of Object.entries(args[2] as Record<string, unknown>))
      if (typeof v === 'string') target[k] = v;
  }
  return seen ? { defaults, updates } : null;
}
