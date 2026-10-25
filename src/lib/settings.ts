export interface Settings {
  drConsent: boolean; // chosen on the Terms screen; no DR lookup is ever sent before it
  showDrBadge: boolean;
  cwvBadgeColour: boolean; // opt-in: colour the badge by this page load's Core Web Vitals
  offline: boolean; // no requests except to the site being viewed
  errorReports: boolean; // anonymous error counts in the daily report, opt-in
  usageStats: boolean; // anonymous daily counters, opt-in on the Terms screen or in Settings
  termsAccepted: string; // the TERMS_VERSION accepted on the Terms screen, '' before
  rememberChanges: boolean; // keep page digests for "Changed since your last visit"
}

export const DEFAULT_SETTINGS: Settings = {
  drConsent: false,
  showDrBadge: true,
  cwvBadgeColour: false,
  offline: false,
  errorReports: false,
  usageStats: false,
  termsAccepted: '',
  rememberChanges: true,
};

export const SETTINGS_KEY = 'settings';

export function withDefaults(stored: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...stored };
}
