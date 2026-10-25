// Shapes of the VitalSentinel public API (/api/public/v1) the extension reads. Only the fields
// the UI uses are typed; the API documents the rest in its OpenAPI schema.

import type { AuthState } from './messages';
import { siteOf } from './url';

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
  total: number | null;
}

export interface Workspace {
  id: string;
  name: string;
  plan: string | null;
}

export interface Domain {
  id: string;
  workspace_id: string;
  domain: string;
  active_modules: string[];
}

export type SectionStatus =
  'ok' | 'no_data' | 'not_connected' | 'not_in_scope' | 'not_applicable' | 'timeout';

export interface Section {
  status: SectionStatus;
  as_of: string | null;
  reason?: string;
  scope?: 'url' | 'domain'; // set when fallback=domain is requested
  deep_link?: string;
}

export interface SearchConsoleSection extends Section {
  window_days: number;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  average_position: number | null;
  top_queries:
    | { query: string; clicks: number; impressions: number; average_position: number | null }[]
    | null;
}

export interface IndexingSection extends Section {
  verdict: string | null;
  coverage_state: string | null;
  google_canonical: string | null;
  user_canonical: string | null;
  canonical_differs: boolean | null;
  last_crawl_time: string | null;
  crawled_as: string | null;
  inspected_at?: string | null; // when VitalSentinel last inspected the URL; newer app versions
}

export interface WebAnalyticsSection extends Section {
  window_days: number;
  path: string;
  pageviews: number | null;
  entrances: number | null;
  bounce_rate: number | null;
  // The Web Analytics overview's figures for this path; older app versions leave them out.
  visitors?: number | null;
  visits?: number | null;
  views_per_visit?: number | null;
  time_per_visit_s?: number | null;
}

export interface CruxRecord {
  form_factor: string;
  metric: string;
  collection_date: string;
  p75: number | null;
  good_share: number | null;
}

export interface CruxSection extends Section {
  records: CruxRecord[]; // the newest collection per form factor and metric
  history?: Omit<CruxRecord, 'good_share'>[]; // every collection in the window, when days is sent
}

export interface CrawlSection extends Section {
  watch: { id: string; state: string } | null;
}

export interface WatchCreated {
  watch: { id: string };
  duplicate: boolean;
}

export interface UrlOverview {
  domain_id: string;
  url: string;
  generated_at: string;
  cached: boolean;
  missing_scopes: string[];
  sections: {
    crawl?: CrawlSection;
    search_console?: SearchConsoleSection;
    indexing?: IndexingSection;
    web_analytics?: WebAnalyticsSection;
    crux?: CruxSection;
  } & Record<string, Section | undefined>;
}

export interface Me {
  user_id: string;
  scopes: string[];
  roles: Record<string, string>;
  // Newer app versions; older ones send neither.
  name?: string | null;
  email?: string | null;
}

/** The API HTML-escapes strings harvested from sites; the popup renders text, so unescape. */
export function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The monitored domain for a hostname: exact, then www-less, then a parent domain within the
 * same registrable domain (so a monitored `github.io` never matches someone else's site on it).
 */
export function matchDomain(domains: Domain[], host: string): Domain | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  const norm = (d: string) => d.toLowerCase().replace(/^www\./, '');
  const site = siteOf(h);
  return (
    domains.find((d) => norm(d.domain) === h) ??
    domains
      .filter((d) => h.endsWith('.' + norm(d.domain)) && norm(d.domain).endsWith(site))
      .sort((a, b) => norm(b.domain).length - norm(a.domain).length)[0] ??
    null
  );
}

export const ok = <T extends Section>(s: T | undefined): s is T => s?.status === 'ok';

/**
 * Who is signed in, for the sidebar and Settings: the user when the app reports them, and how
 * many workspaces there are. Workspace names are never shown.
 */
export function accountLabel(auth: AuthState) {
  const { user, workspaces } = auth;
  const initials = user
    ? (user.includes('@')
        ? user
        : user
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
      ).slice(0, 2)
    : 'VS';
  return {
    initials: initials.toUpperCase(),
    title: user ?? 'Signed in',
    detail: workspaces.length > 1 ? `${workspaces.length} workspaces` : 'VitalSentinel',
  };
}
