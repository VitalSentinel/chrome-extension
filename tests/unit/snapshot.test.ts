import { describe, expect, it } from 'vitest';
import { collectSnapshot } from '../../src/lib/snapshot';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const PAGE_URL = 'https://www.example.com/blog/post';

const PAGE = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>  Best   running shoes
    2026 </title>
  <meta name="Description" content="  Our   picks. ">
  <meta property="og:title" content="OG title">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta charset="utf-8">
  <link rel="canonical" href="/blog/post">
  <link rel="alternate" hreflang="de" href="https://www.example.de/blog/post">
  <link rel="alternate" type="application/rss+xml" href="/feed">
  <link rel="Preload Stylesheet" href="/a.css">
  <link rel="icon" href="/favicon.ico">
  <script src="/app.js"></script>
  <script type="application/ld+json">{"@type":"Article","headline":"x"}</script>
  <style>.x{}</style>
</head>
<body>
  <header><nav><a href="/">Home</a> <a href="https://other.com" rel="NoFollow Sponsored">Partner</a></nav></header>
  <main>
    <h1>  Best <em>running</em> shoes </h1>
    <h3>Sub</h3>
    <p>One two three, four – five 6 !!</p>
    <a href="post-2">Read more</a>
    <a href="#top">Top</a>
    <a href="mailto:a@b.c">Mail</a>
    <a href="javascript:void(0)">JS</a>
    <a href="tel:+123">Call</a>
    <a href="/x" aria-label="  Icon link "></a>
    <a href="/y"><img src="https://cdn.example.com/i.png" alt="Logo"></a>
    <img src="https://cdn.example.com/hero.jpg" width="800" loading="LAZY">
    <div itemscope itemtype="https://schema.org/Product"></div>
    <span itemtype="http://schema.org/Product"></span>
    <script>var words = 'not counted at all here';</script>
    <noscript>no script text</noscript>
  </main>
  <footer><a href="/about">About</a></footer>
</body>
</html>`;

describe('collectSnapshot (raw HTML, no window)', () => {
  const s = collectSnapshot(parse(PAGE), null, PAGE_URL);

  it('reads title, lang, charset and meta', () => {
    expect(s.url).toBe(PAGE_URL);
    expect(s.title).toBe('Best running shoes 2026');
    expect(s.lang).toBe('en-GB');
    expect(s.charset.toLowerCase()).toBe('utf-8');
    expect(s.meta).toEqual([
      { key: 'description', content: 'Our picks.' },
      { key: 'og:title', content: 'OG title' },
      { key: 'x-ua-compatible', content: 'IE=edge' },
    ]);
  });

  it('resolves canonicals, hreflang, scripts and stylesheets against the page URL', () => {
    expect(s.canonicals).toEqual(['https://www.example.com/blog/post']);
    expect(s.hreflang).toEqual([{ lang: 'de', href: 'https://www.example.de/blog/post' }]);
    expect(s.scripts).toEqual(['https://www.example.com/app.js']);
    expect(s.stylesheets).toEqual(['https://www.example.com/a.css']);
    expect(s.jsonLd).toEqual(['{"@type":"Article","headline":"x"}']);
  });

  it('collects headings with collapsed whitespace', () => {
    expect(s.headings).toEqual([
      { level: 1, text: 'Best running shoes' },
      { level: 3, text: 'Sub' },
    ]);
  });

  it('collects links, skipping fragment, mailto, tel and javascript ones', () => {
    expect(s.links).toEqual([
      { href: 'https://www.example.com/', text: 'Home', rel: '', inNav: true },
      { href: 'https://other.com/', text: 'Partner', rel: 'nofollow sponsored', inNav: true },
      { href: 'https://www.example.com/blog/post-2', text: 'Read more', rel: '', inNav: false },
      { href: 'https://www.example.com/x', text: 'Icon link', rel: '', inNav: false },
      { href: 'https://www.example.com/y', text: 'Logo', rel: '', inNav: false },
      { href: 'https://www.example.com/about', text: 'About', rel: '', inNav: true },
    ]);
    expect(s.shortText).toEqual(['Read more']);
  });

  it('counts words without script, style and noscript text', () => {
    // Home Partner | Best running shoes | Sub | One two three, four five 6 | Read more Top Mail JS Call | About
    expect(s.wordCount).toBe(2 + 3 + 1 + 6 + 6 + 1);
  });

  it('reads images', () => {
    expect(s.images).toHaveLength(2);
    expect(s.images[1]).toMatchObject({
      src: 'https://cdn.example.com/hero.jpg',
      alt: null,
      widthAttr: true,
      heightAttr: false,
      loading: 'lazy',
      bytes: 0,
    });
    expect(s.images[0]?.alt).toBe('Logo');
  });

  it('dedupes microdata types and flags semantic elements', () => {
    expect(s.microdataTypes).toEqual(['Product']);
    expect(s.semantic).toEqual({
      main: true,
      article: false,
      nav: true,
      header: true,
      footer: true,
    });
  });

  it('has no timing without a window and sizes the HTML from the DOM', () => {
    expect(s.resources).toEqual([]);
    expect(s.timing).toEqual({ ttfb: 0, fcp: 0, domContentLoaded: 0, load: 0, transferSize: 0 });
    expect(s.htmlBytes).toBeGreaterThan(1000);
    expect(s.status).toBe(0);
    expect(s.serviceWorker).toBe(false);
  });

  it('honours <base href> for relative URLs', () => {
    const d = parse(
      '<head><base href="https://cdn.example.net/sub/"><link rel="canonical" href="page"></head><body><a href="x">X</a></body>',
    );
    const r = collectSnapshot(d, null, PAGE_URL);
    expect(r.canonicals).toEqual(['https://cdn.example.net/sub/page']);
    expect(r.links[0]?.href).toBe('https://cdn.example.net/sub/x');
  });

  it('copes with an empty document', () => {
    const r = collectSnapshot(parse(''), null, PAGE_URL);
    expect(r.title).toBe('');
    expect(r.lang).toBe('');
    expect(r.wordCount).toBe(0);
    expect(r.semantic.main).toBe(false);
  });

  it('treats role=main as main', () => {
    expect(collectSnapshot(parse('<div role="main">x</div>'), null, PAGE_URL).semantic.main).toBe(
      true,
    );
  });
});

describe('collectSnapshot (live window)', () => {
  const entry = (o: Record<string, unknown>) => o as unknown as PerformanceEntry;
  const resources = [
    entry({
      name: 'https://cdn.example.com/hero.jpg',
      initiatorType: 'img',
      transferSize: 50_300,
      encodedBodySize: 50_000,
      decodedBodySize: 50_000,
      startTime: 120.4,
      duration: 80.6,
    }),
    entry({
      name: 'https://www.example.com/a.css',
      initiatorType: 'link',
      transferSize: 2_300,
      encodedBodySize: 0,
      decodedBodySize: 9_000,
      startTime: 10,
      duration: 20,
      renderBlockingStatus: 'blocking',
    }),
  ];
  const navEntry = entry({
    startTime: 0,
    responseStart: 210.7,
    domContentLoadedEventEnd: 900.2,
    loadEventEnd: 1500.6,
    transferSize: 31_000,
    decodedBodySize: 120_000,
    responseStatus: 404,
    workerStart: 1.2,
  });
  const win = {
    innerHeight: 600,
    performance: {
      getEntriesByType: (t: string) =>
        t === 'resource' ? resources : t === 'navigation' ? [navEntry] : [],
      getEntriesByName: (n: string) =>
        n === 'first-contentful-paint' ? [entry({ startTime: 640.4 })] : [],
    },
  } as unknown as Window;

  const doc = parse(
    '<html><body><img src="https://cdn.example.com/hero.jpg"><img src="https://cdn.example.com/below.jpg"></body></html>',
  );
  const [hero, below] = [...doc.querySelectorAll('img')] as [HTMLImageElement, HTMLImageElement];
  const rect = (top: number, h: number) => () =>
    ({
      top,
      bottom: top + h,
      width: 300.4,
      height: h,
      left: 0,
      right: 300,
      x: 0,
      y: top,
      toJSON() {},
    }) as DOMRect;
  hero.getBoundingClientRect = rect(100, 200);
  below.getBoundingClientRect = rect(1200, 200);
  const s = collectSnapshot(doc, win, PAGE_URL);

  it('reads navigation and paint timing', () => {
    expect(s.timing).toEqual({
      ttfb: 211,
      fcp: 640,
      domContentLoaded: 900,
      load: 1501,
      transferSize: 31_000,
    });
    expect(s.htmlBytes).toBe(120_000);
    expect(s.status).toBe(404);
    expect(s.serviceWorker).toBe(true);
  });

  it('maps resource timing entries', () => {
    expect(s.resources).toEqual([
      {
        url: 'https://cdn.example.com/hero.jpg',
        type: 'img',
        transferSize: 50_300,
        encodedSize: 50_000,
        decodedSize: 50_000,
        renderBlocking: false,
        start: 120,
        duration: 81,
      },
      {
        url: 'https://www.example.com/a.css',
        type: 'link',
        transferSize: 2_300,
        encodedSize: 0,
        decodedSize: 9_000,
        renderBlocking: true,
        start: 10,
        duration: 20,
      },
    ]);
  });

  it('uses layout and resource sizes for images', () => {
    expect(s.images[0]).toMatchObject({
      aboveFold: true,
      renderedWidth: 300,
      renderedHeight: 200,
      bytes: 50_000,
    });
    expect(s.images[1]).toMatchObject({ aboveFold: false, bytes: 0 });
  });
});

describe('collectSnapshot (shadow DOM)', () => {
  const win = {
    innerHeight: 600,
    performance: { getEntriesByType: () => [] },
  } as unknown as Window;

  it('reads links and headings inside open shadow roots, nested ones too', () => {
    const doc = parse('<html><body><site-nav></site-nav><p>Body text here</p></body></html>');
    const outer = doc.querySelector('site-nav')!.attachShadow({ mode: 'open' });
    outer.innerHTML = '<h2>Menu</h2><a href="/a">A</a><nav-item></nav-item>';
    outer.querySelector('nav-item')!.attachShadow({ mode: 'open' }).innerHTML =
      '<a href="/b">B</a>';
    const s = collectSnapshot(doc, win, PAGE_URL);
    expect(s.links.map((l) => new URL(l.href).pathname)).toEqual(['/a', '/b']);
    expect(s.headings).toEqual([{ level: 2, text: 'Menu' }]);
  });

  it('keeps headings in the order they render, shadow ones included', () => {
    const doc = parse('<body><h1>Title</h1><x-card></x-card><h3>Detail</h3></body>');
    doc.querySelector('x-card')!.attachShadow({ mode: 'open' }).innerHTML = '<h2>Section</h2>';
    expect(collectSnapshot(doc, win, PAGE_URL).headings.map((h) => h.level)).toEqual([1, 2, 3]);
  });

  it('counts words across inline elements the way textContent does', () => {
    const doc = parse('<body><p>un<b>break</b>able words</p><svg><text>no</text></svg></body>');
    expect(collectSnapshot(doc, null, PAGE_URL).wordCount).toBe(2);
  });
});
