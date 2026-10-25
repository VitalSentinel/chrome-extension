// Shapes shared by the page analyser, the service worker and the popup. Everything here is
// plain JSON so it can cross chrome.runtime messaging and chrome.storage unchanged.

export type Level = 'good' | 'warn' | 'bad' | 'info';

/** One check result. `id` names a message in src/i18n; `params` fill it. */
export interface Finding {
  id: string;
  level: Level;
  params?: Record<string, string | number>;
}

export interface MetaTag {
  key: string; // name, property or http-equiv, lower-cased
  content: string;
}

export interface LinkInfo {
  href: string; // absolute
  text: string;
  rel: string; // lower-cased, space separated
  inNav: boolean;
}

export interface ImageInfo {
  src: string;
  alt: string | null; // null when the attribute is missing
  widthAttr: boolean;
  heightAttr: boolean;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  loading: string; // '', 'lazy', 'eager'
  aboveFold: boolean;
  bytes: number; // 0 when unknown (cross-origin without Timing-Allow-Origin)
}

export interface ResourceInfo {
  url: string;
  type: string; // initiatorType
  transferSize: number;
  encodedSize: number;
  decodedSize: number;
  renderBlocking: boolean;
  start: number;
  duration: number;
}

/** What the analyser reads from the rendered DOM of the current tab. */
export interface PageSnapshot {
  url: string;
  title: string;
  lang: string;
  charset: string;
  meta: MetaTag[];
  canonicals: string[];
  hreflang: { lang: string; href: string }[];
  headings: { level: number; text: string }[];
  wordCount: number;
  links: LinkInfo[];
  images: ImageInfo[];
  jsonLd: string[];
  microdataTypes: string[];
  semantic: Record<'main' | 'article' | 'nav' | 'header' | 'footer', boolean>;
  scripts: string[];
  stylesheets: string[];
  resources: ResourceInfo[];
  timing: {
    ttfb: number;
    fcp: number;
    domContentLoaded: number;
    load: number;
    transferSize: number;
  };
  htmlBytes: number;
  shortText: string[]; // link texts like "Read more" collected for a11y and SEO checks
  /**
   * HTTP status of this document from the page's own Navigation Timing entry; 0 when unknown
   * (a raw snapshot, an older browser). The fallback when the worker saw no response.
   */
  status?: number;
  /**
   * A service worker handled this document's request (Navigation Timing `workerStart`). When it
   * answered from its cache or its own fetch, webRequest saw no main-frame response.
   */
  serviceWorker?: boolean;
  /** Core Web Vitals from buffered performance entries (the popup's fallback). */
  bufferedVitals?: TabVitals;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface RequestInfo {
  url: string;
  host: string;
  type: string;
  status: number;
  t: number; // ms after the navigation started
  encoding: string;
  cacheControl: string;
  size: number; // content-length, 0 when unknown
}

/** What the service worker records for the top-level navigation of a tab (no subresources). */
export interface NavRecord {
  tabId: number;
  url: string;
  status: number;
  statusLine: string;
  headers: [string, string][];
  redirects: RedirectHop[];
  clientRedirect: boolean;
  startedAt: number;
}

export interface VitalSample {
  name: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  target?: string;
}

export interface LayoutShiftInfo {
  value: number;
  selectors: string[];
}

export interface TabVitals {
  url: string;
  metrics: Partial<Record<VitalSample['name'], VitalSample>>;
  shifts: LayoutShiftInfo[];
}

export interface DomainRating {
  domain: string;
  domainRating: number | null;
  fetchedAt: string;
  stale: boolean;
}
