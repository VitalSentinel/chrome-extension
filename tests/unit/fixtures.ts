import type {
  ImageInfo,
  LinkInfo,
  NavRecord,
  PageSnapshot,
  ResourceInfo,
} from '../../src/lib/types';

// Small builders so each test spells out only the fields it cares about.

export function snap(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://www.example.com/page',
    title: '',
    lang: 'en',
    charset: 'UTF-8',
    meta: [],
    canonicals: [],
    hreflang: [],
    headings: [],
    wordCount: 500,
    links: [],
    images: [],
    jsonLd: [],
    microdataTypes: [],
    semantic: { main: false, article: false, nav: false, header: false, footer: false },
    scripts: [],
    stylesheets: [],
    resources: [],
    timing: { ttfb: 0, fcp: 0, domContentLoaded: 0, load: 0, transferSize: 0 },
    htmlBytes: 10_000,
    shortText: [],
    ...overrides,
  };
}

export const meta = (entries: Record<string, string>) =>
  Object.entries(entries).map(([key, content]) => ({ key, content }));

export function nav(overrides: Partial<NavRecord> = {}): NavRecord {
  return {
    tabId: 1,
    url: 'https://www.example.com/page',
    status: 200,
    statusLine: 'HTTP/1.1 200 OK',
    headers: [],
    redirects: [],
    clientRedirect: false,
    startedAt: 0,
    ...overrides,
  };
}

export function link(href: string, overrides: Partial<LinkInfo> = {}): LinkInfo {
  return { href, text: 'Link text', rel: '', inNav: false, ...overrides };
}

export function image(overrides: Partial<ImageInfo> = {}): ImageInfo {
  return {
    src: 'https://www.example.com/a.webp',
    alt: 'alt',
    widthAttr: true,
    heightAttr: true,
    naturalWidth: 400,
    naturalHeight: 300,
    renderedWidth: 400,
    renderedHeight: 300,
    loading: 'lazy',
    aboveFold: false,
    bytes: 0,
    ...overrides,
  };
}

export function resource(url: string, overrides: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    url,
    type: 'script',
    transferSize: 0,
    encodedSize: 0,
    decodedSize: 0,
    renderBlocking: false,
    start: 0,
    duration: 0,
    ...overrides,
  };
}

export const ids = (findings: { id: string }[]) => findings.map((f) => f.id);
