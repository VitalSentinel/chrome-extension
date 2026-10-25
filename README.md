# VitalSentinel – SEO Extension

A Chrome and Edge extension (Manifest V3) that audits the page you are on. Every on-page check
runs in your browser, without an account. Signing in with a VitalSentinel account adds the
monitoring data VitalSentinel holds for the sites you track.

It replaces the on-page features of the Ahrefs SEO Toolbar and all of Quick JavaScript
Switcher, and brings the checks behind [vitalsentinel.com/tools](https://vitalsentinel.com/tools)
into the browser.

## Features

The toolbar popup has a sidebar of report groups. Opening a page expands its group to list the
group's pages.

**This page**

- **Overview** – status, indexability verdict, title, description, canonical, H1, Core Web
  Vitals, the main issues, and what changed since your last visit.
- **On-page**
  - Content – length checks, heading outline, page tags and a desktop Google snippet preview
    with pixel-width truncation.
  - Structured data – JSON-LD items with required and recommended properties for rich result
    types, links to the Rich Results Test and the Schema.org validator.
  - Social tags – Facebook / LinkedIn and X previews and every Open Graph and X tag.
  - Images – alt text, dimensions, lazy loading, format, size and the estimated savings from
    resizing or WebP/AVIF.
- **Crawl and index**
  - Indexability – one verdict from status, meta robots, X-Robots-Tag, canonical and
    robots.txt; sitemaps; hreflang; raw HTML versus the rendered DOM.
  - Crawlers – whether search engine and AI crawlers may crawl the page, with the deciding
    robots.txt rule.
  - Links – internal, external and nofollow links and status checks on request.
- **Performance** – Core Web Vitals measured on your device for the real page load, CrUX
  data for sites you monitor with VitalSentinel, a PageSpeed Insights test link, an on-page overlay of the LCP element and layout shifts, and a
  resource audit (render-blocking, uncompressed or short-cached files, third-party weight).
- **Technical**
  - HTTP headers – redirect chain, security headers, caching and compression, every response
    header.
  - Tech and tracking – CMS, framework, CDN and analytics detection; trackers and cookies
    loaded before consent; Consent Mode v2 status.
  - Accessibility – an axe-core audit.
  - AI readiness – llms.txt, AI crawler rules, content without JavaScript, structured data and
    semantic HTML.

**Your site** (requires sign-in)

- **VitalSentinel** – for a site you monitor, the last 90 days of the current URL right in the
  reports: Google Search Console on Content, the Google index on Indexability, CrUX on Performance and
  Overview, and a brief summary with Web Analytics in the VitalSentinel tab, falling back to
  domain-level data where the URL has none. "Watch this page" (Overview and the VitalSentinel
  tab) adds the URL to page monitoring; "Stop watching" removes it. Signed out, or on a site you do not monitor yet, it
  leads with the free plan and shows every VitalSentinel module.

**Tools**

- **JavaScript switcher** – allow or block JavaScript per site: per-host and per-domain rules,
  rule export, Alt+Shift+Q and a context menu entry.
- **Settings** – your VitalSentinel account, Domain Rating lookup, offline mode, opt-in badge
  colouring, history controls, and anonymous usage statistics and error reports.

**Toolbar badge** – shows the site's Domain Rating (Domain Rating by
[Ahrefs](https://ahrefs.com/)) once you turn the lookup on. Grey while JavaScript is blocked.
Optionally coloured by the page's on-device
Core Web Vitals.

Dark mode follows the system.

## Privacy

The extension does its work in the browser. It reads the page, its headers and its redirect
chain itself and fetches robots.txt, sitemaps and raw HTML straight from the site. It never
sends your browsing history.

What leaves the browser:

- **The site you are viewing** – ordinary requests for raw HTML, robots.txt, sitemaps,
  llms.txt and link checks, when a report needs them. Link checks on request also reach the
  sites the page links to.
- **VitalSentinel** – only after you turn on Domain Rating: the domain of the current tab, for
  the badge (at most once per domain per 7 days, cached locally). When you are signed in and
  the site is one you monitor: the full URL of the current tab.
- **VitalSentinel, anonymously** – once a day, counts of how often features were used and how
  often something failed, with the version, browser and language. No addresses, domains,
  results or identifiers, and no token or cookies. Off until you turn them on with one
  switch, on the Terms screen or in Settings.

Offline mode turns off every request except those to the site itself. Full detail:
[PRIVACY.md](PRIVACY.md) and [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Install

- Chrome Web Store: _link to follow after store approval_
- Microsoft Edge Add-ons: _link to follow after store approval_

### Load unpacked from a build

```sh
npm ci
npm run build          # Chrome: .output/chrome-mv3
npm run build:edge     # Edge:   .output/edge-mv3
```

Open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose **Load
unpacked** and select the output folder.

## Development

Requires Node 22 (see `.nvmrc`).

```sh
nvm use
npm ci
npm run dev            # Chrome with hot reload; npm run dev:edge for Edge
npm test               # unit tests
npm run typecheck && npm run lint
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for environment variables, testing and the
development extension ID.

## Tech stack

[WXT](https://wxt.dev/) 0.21 (Vite), Preact 11, TypeScript 7, Tailwind CSS 3.4, Vitest 5,
Playwright, oxlint and Prettier. Runtime dependencies: `preact`, `web-vitals` and `axe-core`.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – how the worker, popup and page scripts fit
  together
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) – every permission and why it is needed
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) – setup, scripts, tests, configuration
- [docs/RELEASING.md](docs/RELEASING.md) – versioning and store releases
- [PRIVACY.md](PRIVACY.md) – what the extension stores and sends
- [CONTRIBUTING.md](CONTRIBUTING.md) – how to propose changes
- [SECURITY.md](SECURITY.md) – reporting a vulnerability
- [CHANGELOG.md](CHANGELOG.md) – release notes

## Licence

[MIT](LICENSE). axe-core is used under the MPL 2.0. Domain Rating data is provided by Ahrefs
and shown with its attribution.
