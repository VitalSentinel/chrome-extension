import type { ImageInfo, LinkInfo, PageSnapshot, ResourceInfo } from './types';

// Runs inside the inspected tab (isolated world) when the popup opens. Reads only; it never
// changes the page. Kept free of chrome.* so it is unit-tested against happy-dom.

const SHORT_LINK = /^(read more|more|click here|here|learn more|continue|details|link)$/i;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function abs(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** Visible text of an element: inline scripts and styles inside it are not text. */
function textOf(el: Element): string {
  if (!el.querySelector('script,style,noscript,template')) return clean(el.textContent);
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());
  return clean(copy.textContent);
}

function words(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

/** Body text without script, style and SVG text, read in place: cloning a huge DOM is slow. */
function mainText(doc: Document): string {
  const body = doc.body;
  if (!body) return '';
  const parts: string[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === 1 && NOT_TEXT.has((n as Element).tagName.toUpperCase())
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (n.nodeType === 3) parts.push(n.nodeValue ?? '');
  return parts.join('');
}

/**
 * Open shadow roots, nested ones too. Google flattens them when it renders, and web
 * components often hold a site's navigation. Closed roots cannot be read by anyone.
 */
function shadowRoots(doc: Document): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const visit = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*'))
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        visit(el.shadowRoot);
      }
  };
  visit(doc);
  return roots;
}

/** Position in the flattened tree: child indices from the document, a shadow root at -1. */
function flatPath(el: Element): number[] {
  const path: number[] = [];
  for (let n: Node | null = el; n && n.nodeType !== 9;) {
    const parent: Node | null = n.parentNode;
    if (parent instanceof ShadowRoot) {
      path.push([...parent.children].indexOf(n as Element), -1);
      n = parent.host;
    } else {
      path.push(parent ? [...(parent as Element).children].indexOf(n as Element) : 0);
      n = parent;
    }
  }
  return path.reverse();
}

function byFlatOrder(a: Element, b: Element): number {
  const pa = flatPath(a);
  const pb = flatPath(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++)
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return pa.length - pb.length;
}

/**
 * `win` is null for a document parsed from raw HTML (no layout, no performance timeline);
 * `url` must then be given, because a parsed document has no location.
 */
export function collectSnapshot(
  doc: Document,
  win: Window | null = window,
  url = doc.URL,
): PageSnapshot {
  const base = win
    ? doc.baseURI || url
    : abs(doc.querySelector('base')?.getAttribute('href') ?? '', url) || url;
  const viewportHeight = win?.innerHeight || 800;
  // A parsed document has no scripts run, so no shadow roots either.
  const roots = win ? shadowRoots(doc) : [];
  const all = <E extends Element = Element>(selector: string): E[] => [
    ...doc.querySelectorAll<E>(selector),
    ...roots.flatMap((r) => [...r.querySelectorAll<E>(selector)]),
  ];

  const meta = [...doc.querySelectorAll('meta')]
    .map((m) => ({
      key: (
        m.getAttribute('name') ||
        m.getAttribute('property') ||
        m.getAttribute('http-equiv') ||
        ''
      ).toLowerCase(),
      content: clean(m.getAttribute('content')),
    }))
    .filter((m) => m.key);

  const linkEls = [...doc.querySelectorAll<HTMLLinkElement>('link[rel][href]')];
  const relIs = (el: HTMLLinkElement, rel: string) =>
    el.getAttribute('rel')!.toLowerCase().split(/\s+/).includes(rel);

  const links: LinkInfo[] = [];
  const shortText: string[] = [];
  for (const a of all<HTMLAnchorElement>('a[href]')) {
    const raw = a.getAttribute('href')!.trim();
    if (!raw || /^(javascript:|data:|vbscript:|mailto:|tel:|#)/i.test(raw)) continue;
    const text =
      clean(a.textContent) ||
      clean(a.getAttribute('aria-label')) ||
      clean(a.querySelector('img')?.getAttribute('alt'));
    if (SHORT_LINK.test(text)) shortText.push(text);
    links.push({
      href: abs(raw, base),
      text,
      rel: (a.getAttribute('rel') ?? '').toLowerCase(),
      inNav: !!a.closest('nav,header,footer'),
    });
  }

  const resourceEntries = (win?.performance?.getEntriesByType?.('resource') ??
    []) as PerformanceResourceTiming[];
  const sizeByUrl = new Map(
    resourceEntries.map((r) => [r.name, r.encodedBodySize || r.transferSize]),
  );

  const images: ImageInfo[] = all<HTMLImageElement>('img').map((img) => {
    const rect = img.getBoundingClientRect();
    const src = (win && img.currentSrc) || abs(img.getAttribute('src') ?? '', base);
    return {
      src,
      alt: img.getAttribute('alt'),
      widthAttr: img.hasAttribute('width'),
      heightAttr: img.hasAttribute('height'),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: Math.round(rect.width),
      renderedHeight: Math.round(rect.height),
      loading: (img.getAttribute('loading') ?? '').toLowerCase(),
      aboveFold: rect.top < viewportHeight && rect.bottom > 0,
      bytes: sizeByUrl.get(src) ?? 0,
    };
  });

  const resources: ResourceInfo[] = resourceEntries.slice(0, 400).map((r) => ({
    url: r.name,
    type: r.initiatorType,
    transferSize: r.transferSize,
    encodedSize: r.encodedBodySize,
    decodedSize: r.decodedBodySize,
    renderBlocking:
      (r as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus ===
      'blocking',
    start: Math.round(r.startTime),
    duration: Math.round(r.duration),
  }));

  const nav = win?.performance?.getEntriesByType?.('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  const fcp = win?.performance?.getEntriesByName?.('first-contentful-paint')[0];

  return {
    url,
    title: clean(doc.title),
    lang: doc.documentElement.getAttribute('lang') ?? '',
    charset: doc.characterSet,
    meta,
    canonicals: linkEls
      .filter((l) => relIs(l, 'canonical'))
      .map((l) => abs(l.getAttribute('href')!, base)),
    hreflang: linkEls
      .filter((l) => relIs(l, 'alternate') && l.hasAttribute('hreflang'))
      .map((l) => ({
        lang: l.getAttribute('hreflang')!,
        href: abs(l.getAttribute('href')!, base),
      })),
    // Heading checks read the order, so headings inside web components go where they render.
    headings: (roots.length
      ? all('h1,h2,h3,h4,h5,h6').sort(byFlatOrder)
      : all('h1,h2,h3,h4,h5,h6')
    ).map((h) => ({
      level: Number(h.tagName[1]),
      text: textOf(h).slice(0, 200),
    })),
    wordCount: words(mainText(doc)),
    links,
    images,
    jsonLd: [...doc.querySelectorAll('script[type="application/ld+json"]')].map(
      (s) => s.textContent ?? '',
    ),
    microdataTypes: [
      ...new Set(
        [...doc.querySelectorAll('[itemtype]')].map((e) =>
          e.getAttribute('itemtype')!.split('/').pop()!,
        ),
      ),
    ],
    semantic: {
      main: !!doc.querySelector('main,[role=main]'),
      article: !!doc.querySelector('article'),
      nav: !!doc.querySelector('nav'),
      header: !!doc.querySelector('header'),
      footer: !!doc.querySelector('footer'),
    },
    scripts: [...doc.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) =>
      abs(s.getAttribute('src')!, base),
    ),
    stylesheets: linkEls
      .filter((l) => relIs(l, 'stylesheet'))
      .map((l) => abs(l.getAttribute('href')!, base)),
    resources,
    timing: {
      ttfb: nav ? Math.round(nav.responseStart - nav.startTime) : 0,
      fcp: fcp ? Math.round(fcp.startTime) : 0,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      load: nav ? Math.round(nav.loadEventEnd) : 0,
      transferSize: nav?.transferSize ?? 0,
    },
    htmlBytes: nav?.decodedBodySize || doc.documentElement.outerHTML.length,
    shortText,
    // Chrome 109+. The worker records the status too, but only for loads it saw.
    status: (nav as { responseStatus?: number } | undefined)?.responseStatus ?? 0,
    serviceWorker: (nav?.workerStart ?? 0) > 0,
  };
}
