import type { PageKey } from '../popup/nav';
import type { Settings } from './settings';

// Anonymous usage statistics and error counts: a fixed list of counters, summed per UTC day and
// sent once a day. No identifier, URL, domain, message or result is ever part of a report – only
// these names and numbers. `error.*` counters follow the error report switch, the rest the usage
// statistics switch.

const PAGES: PageKey[] = [
  'overview',
  'content',
  'schema',
  'social',
  'images',
  'indexability',
  'crawlers',
  'links',
  'performance',
  'headers',
  'tech',
  'a11y',
  'ai',
  'vs-all',
];

export const EVENTS = [
  'install',
  'update',
  'popup.open',
  'settings.open',
  ...PAGES.map((p) => `page.${p}` as const),
  'js.popup',
  'js.shortcut',
  'js.menu',
  'axe.run',
  'links.check',
  'overlay.show',
  'copy.headers',
  'copy.schema',
  'signin',
  'signout',
  'watch',
  'promo.click',
  'error.analysis',
  'error.report',
  'error.axe',
  'error.app',
  'error.signin',
  'error.dr',
  'error.worker',
] as const;

export type UsageEvent = (typeof EVENTS)[number];

export const isUsageEvent = (e: unknown): e is UsageEvent =>
  typeof e === 'string' && (EVENTS as readonly string[]).includes(e);

/** Counters per UTC day, e.g. `{ '2026-10-25': { 'popup.open': 3 } }`. */
export type UsageDays = Record<string, Partial<Record<UsageEvent, number>>>;

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export function bump(days: UsageDays, event: UsageEvent, now: number): UsageDays {
  const day = utcDay(now);
  const counts = days[day] ?? {};
  return { ...days, [day]: { ...counts, [event]: (counts[event] ?? 0) + 1 } };
}

const isError = (e: string) => e.startsWith('error.');

/** Keeps only the counters the current settings allow. */
export function allowedCounts(counts: UsageReport['counts'], s: Settings): UsageReport['counts'] {
  return Object.fromEntries(
    Object.entries(counts).filter(([e]) => (isError(e) ? s.errorReports : s.usageStats)),
  );
}

export interface UsageReport {
  schema: 1;
  day: string;
  version: string;
  browser: 'chrome' | 'edge';
  build: 'store' | 'dev';
  lang: string;
  signedIn: boolean;
  /** Only with usage statistics on; error counts alone carry no settings. */
  flags?: Record<'drConsent' | 'showDrBadge' | 'cwvBadgeColour' | 'rememberChanges', boolean>;
  counts: Partial<Record<UsageEvent, number>>;
}

export function usageReport(
  day: string,
  counts: UsageReport['counts'],
  s: Settings,
  env: Pick<UsageReport, 'version' | 'browser' | 'build' | 'lang' | 'signedIn'>,
): UsageReport {
  const report: UsageReport = { schema: 1, day, ...env, counts: allowedCounts(counts, s) };
  if (s.usageStats)
    report.flags = {
      drConsent: s.drConsent,
      showDrBadge: s.showDrBadge,
      cwvBadgeColour: s.cwvBadgeColour,
      rememberChanges: s.rememberChanges,
    };
  return report;
}

/** Counting and sending need the accepted terms, offline mode off and the event's switch on. */
export function usageAllowed(s: Settings, termsVersion: string, event?: UsageEvent): boolean {
  if (s.offline || s.termsAccepted !== termsVersion) return false;
  if (event) return isError(event) ? s.errorReports : s.usageStats;
  return s.usageStats || s.errorReports;
}
