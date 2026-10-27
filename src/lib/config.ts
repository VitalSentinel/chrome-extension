// Build-time endpoints. Development builds (`npm run dev`, `npm run build:local`) talk to the
// app on http://localhost:3000, which proxies /api to the backend; production builds to
// app.vitalsentinel.com. WXT_APP_URL / WXT_API_URL in .env.local override both.

const DEFAULT_URL =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3000'
    : 'https://app.vitalsentinel.com';

export const APP_URL: string = (import.meta.env.WXT_APP_URL || DEFAULT_URL).replace(/\/$/, '');
export const API_URL: string = (import.meta.env.WXT_API_URL || APP_URL).replace(/\/$/, '');
export const API_PREFIX = '/api/public/v1';
export const OAUTH_RESOURCE = 'https://api.vitalsentinel.com';
export const OAUTH_CLIENT_ID: string =
  import.meta.env.WXT_OAUTH_CLIENT_ID || 'vitalsentinel-extension';

export const OAUTH_SCOPES = [
  'read:workspaces',
  'read:domains',
  'read:gsc',
  'read:indexing',
  'read:crux',
  'read:analytics',
  'read:pages',
  'write:pages',
];

export const DR_TTL_MS = 7 * 24 * 3600 * 1000;
export const DOMAINS_TTL_MS = 60 * 60 * 1000;
export const OVERVIEW_TTL_MS = 60 * 60 * 1000;

/** The Terms and Privacy Policy in force; a new version asks for acceptance again. */
export const TERMS_VERSION = '2026-10-27';
export const TERMS_URL = 'https://www.vitalsentinel.com/terms-and-conditions';
export const PRIVACY_URL = 'https://www.vitalsentinel.com/privacy-policy#browser-extension';

export const UTM = 'utm_source=extension&utm_medium=popup';

/** The app's add-domain flow; `domain` prefills the host and survives sign-up when signed out. */
export const addDomainUrl = (host: string) =>
  `${APP_URL}/onboarding/domain?domain=${encodeURIComponent(host)}&utm_source=extension`;

/** Section deep links from the API are paths on the app. */
export const appLink = (path: string) =>
  `${path.startsWith('http') ? path : `${APP_URL}${path}`}${path.includes('?') ? '&' : '?'}${UTM}`;
