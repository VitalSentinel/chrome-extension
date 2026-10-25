// The popup's report pages and how the sidebar groups them. Each page module is loaded on
// first use, so the popup only parses the code of the page that is open.

export type PageKey =
  | 'overview'
  | 'content'
  | 'schema'
  | 'social'
  | 'images'
  | 'indexability'
  | 'crawlers'
  | 'links'
  | 'performance'
  | 'headers'
  | 'tech'
  | 'a11y'
  | 'ai'
  | 'vs-all';

export interface NavGroup {
  key: string;
  label: string;
  pages: { key: PageKey; label: string }[];
}

export const GROUPS: NavGroup[] = [
  { key: 'overview', label: 'Overview', pages: [{ key: 'overview', label: 'Overview' }] },
  {
    key: 'onpage',
    label: 'On-page',
    pages: [
      { key: 'content', label: 'Content' },
      { key: 'schema', label: 'Structured data' },
      { key: 'social', label: 'Social tags' },
      { key: 'images', label: 'Images' },
    ],
  },
  {
    key: 'crawl',
    label: 'Crawl and index',
    pages: [
      { key: 'indexability', label: 'Indexability' },
      { key: 'crawlers', label: 'Crawlers' },
      { key: 'links', label: 'Links' },
    ],
  },
  {
    key: 'performance',
    label: 'Performance',
    pages: [{ key: 'performance', label: 'Performance' }],
  },
  {
    key: 'technical',
    label: 'Technical',
    pages: [
      { key: 'headers', label: 'HTTP headers' },
      { key: 'tech', label: 'Tech and tracking' },
      { key: 'a11y', label: 'Accessibility' },
      { key: 'ai', label: 'AI readiness' },
    ],
  },
];

export const groupOf = (page: PageKey) =>
  GROUPS.find((g) => g.pages.some((p) => p.key === page))?.key ?? 'vitalsentinel';

type PageModule = { default: import('preact').FunctionComponent<import('./types').PageProps> };

export const LOADERS: Record<string, () => Promise<PageModule>> = {
  overview: () => import('./pages/Overview'),
  content: () => import('./pages/Content'),
  schema: () => import('./pages/Schema'),
  social: () => import('./pages/Social'),
  images: () => import('./pages/Images'),
  indexability: () => import('./pages/Indexability'),
  crawlers: () => import('./pages/Crawlers'),
  links: () => import('./pages/Links'),
  performance: () => import('./pages/Performance'),
  headers: () => import('./pages/Headers'),
  tech: () => import('./pages/Tech'),
  a11y: () => import('./pages/Accessibility'),
  ai: () => import('./pages/Ai'),
  vitalsentinel: () => import('./pages/VitalSentinel'),
};

export const loaderFor = (page: PageKey) => LOADERS[page === 'vs-all' ? 'vitalsentinel' : page];

// The page last open in a tab, kept in storage.session so reopening the popup on the same URL
// returns there. Another URL, an unknown key, or a VitalSentinel page while signed out starts
// on the Overview instead.
export interface LastPage {
  url: string;
  page: string;
}
export const lastPageKey = (tabId: number) => `lastPage:${tabId}`;

const KNOWN = new Set<string>([...GROUPS.flatMap((g) => g.pages.map((p) => p.key)), 'vs-all']);

export function restorePage(last: LastPage | undefined, url: string, signedIn: boolean): PageKey {
  if (!last || last.url !== url || !KNOWN.has(last.page)) return 'overview';
  if (last.page === 'vs-all' && !signedIn) return 'overview';
  return last.page as PageKey;
}
