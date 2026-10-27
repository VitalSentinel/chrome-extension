# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.9] – 2026-10-27

### Changed

- The Terms screen asks again for the updated Terms and Privacy Policy.

### Fixed

- Cached account data is now cleared when the session is rejected, as on sign-out.

## [1.0.8] – 2026-10-25

Initial release. One Manifest V3 build for Chrome and Edge.

### Added

- Toolbar popup (800 × 600) with an accordion sidebar of report groups – This page, Your
  site, Tools: opening a page expands its group to list the group's pages, and a collapsed
  group shows its summed issue count, labelled by level. The popup reopens the last report
  page for a tab while its address is unchanged.
- A Terms screen in the popup before the first report: accept the Terms and Conditions and
  confirm the Privacy Policy, with a switch for Domain Rating (starts on) and one for anonymous
  usage and error counts (starts off).
- Anonymous usage statistics and error reports: once a day, counts of report views, feature
  use and failures from a fixed list, with the version, browser, build and UI language. No
  addresses, domains, results, messages or identifiers, sent without a token or cookies; never
  in offline mode or incognito tabs. Off until you turn them on with one switch, on the Terms screen or in Settings.
- Overview: HTTP status, indexability verdict, title, description, canonical, H1, word count,
  language, Core Web Vitals and the page's main issues, each linking to its report.
- Changed since your last visit: title, description, canonical, robots directives, H1, word
  count, structured data types, hreflang and link counts compared with the last time the URL
  was analysed (kept in the browser for 30 days, up to 2,000 URLs; can be turned off).
- On-page › Content: title and description length checks, heading outline with skipped
  levels, page tags, and a desktop Google snippet preview with pixel-width truncation.
- On-page › Structured data: JSON-LD items with required and recommended properties for the
  main rich result types, microdata types, parse errors, links to the Rich Results Test and the
  Schema.org validator, and Copy JSON-LD.
- On-page › Social tags: Facebook / LinkedIn and X previews and every Open Graph and X tag.
- On-page › Images: missing alt attributes, missing dimensions, oversized and lazy-loading
  issues, formats, sizes and the estimated savings from resizing and WebP or AVIF.
- Crawl and index › Indexability: one verdict from status, meta robots, X-Robots-Tag, Link
  header and HTML canonicals and robots.txt; sitemaps declared in robots.txt and whether the
  URL is listed; hreflang table with checks; raw HTML versus the rendered DOM. A page opened
  with tracking parameters (`utm_*`, `gclid`, `fbclid` and similar) whose canonical is the
  same page without them counts as indexable under its clean URL. For a monitored site, the
  verdict also says whether the page is in Google's index, with its last crawl.
- Crawl and index › Crawlers: robots.txt access for search engine and AI crawlers with the
  deciding rule, using Google's matching rules, and the robots.txt file itself.
- Crawl and index › Links: internal, external and nofollow links, sponsored and ugc flags, and
  status checks on request.
- Performance: Core Web Vitals (LCP, INP, CLS, FCP, TTFB) measured on your device for the real
  page load, updating live while the popup is open; CrUX data for monitored sites, a free-domain offer
  and a PageSpeed Insights test link for the rest; an on-page overlay of the LCP element and the largest layout shifts; a resource
  audit of render-blocking, uncompressed and short-cached files and third-party weight, with
  the five heaviest third-party hosts.
- Technical › HTTP headers: status line, redirect chain, security headers (HSTS, CSP, framing,
  nosniff, Referrer-Policy, Permissions-Policy), caching and compression checks, and every
  response header.
- Technical › Tech and tracking: CMS, framework, server, CDN, analytics, ads and consent tool
  detection; trackers and cookies loaded before consent; Consent Mode v2 defaults and updates;
  cookies with purpose and flags.
- Technical › Accessibility: an axe-core audit grouped by impact with the affected elements.
- Technical › AI readiness: llms.txt, AI crawler rules, content without JavaScript,
  structured data, semantic HTML, author and dates, a Markdown version, sitemap listing (once
  Indexability has read the sitemaps, which only that page fetches) and noai directives.
- VitalSentinel data (sign-in required): for a monitored site, the last 90 days of the
  current URL inside the reports – Google Search Console on Content, the Google index on
  Indexability, CrUX on Performance and Overview – each falling back to domain-level data when
  the URL has none. Overview adds a strip with one cell per source that opens its report. The
  VitalSentinel tab sums it up: Google Search Console clicks, impressions, CTR and average
  position; the index status with the last Google crawl and the last check; phone and desktop
  CrUX; and Web Analytics page views, visitors, visits, bounce rate, views and time per visit.
  The popup opens from cached data and fills in the rest as the app answers, with placeholders
  of the final size so nothing moves.
- "Watch this page" on Overview and the VitalSentinel tab adds the current URL to page
  monitoring, and "Stop watching" removes it (owners and admins). Signed out, the
  VitalSentinel tab leads with the free plan (one domain, every module, no credit card) and
  shows all twelve VitalSentinel modules; the offer at the foot of Overview and Performance,
  shown only while signed out, matches it. Signed in on a site none of your workspaces
  monitors, it says so and offers to add the domain.
- Sign-in asks only for the scopes the reports read (workspaces, domains, Google Search
  Console, indexing, CrUX, Web Analytics and pages) plus `write:pages` for watching.
- Sign-in with a VitalSentinel account through OAuth 2.1 with PKCE.
- Toolbar badge with the site's Domain Rating (Domain Rating by Ahrefs) and a grey icon while
  JavaScript is blocked.
- JavaScript switcher: allow or block per host or per domain and subdomains, rule list with
  export, Alt+Shift+Q and a context menu entry.
- Settings: your VitalSentinel account first – who is signed in and the workspaces you
  allowed – with the free-domain offer while signed out; Domain Rating lookup,
  offline mode, opt-in badge colouring by the page's on-device Core Web Vitals,
  "Changed since your last visit" history (Clear history says what it removed), usage statistics and error reports, with a section
  nav that follows the scroll. Switching off the
  history deletes it.
- Dark mode that follows the system.
- WCAG 2.1 AA in light and dark mode: text contrast of at least 4.5:1 on every surface and
  tint, 3:1 for switches and field borders, keyboard focus on every control and the report
  area, checked with axe-core in the end-to-end tests.
- Loading states show the step in progress over placeholder rows shaped like the report.
- Crawl checks read sites the way Google does: robots.txt up to 500 KiB, a server error or 429
  blocks everything, groups match exact user-agent tokens and Google's accepted misspellings;
  sitemaps in gzip or plain text, indexes two levels deep, up to 20 files read four at a time,
  including 50,000-URL files; raw HTML decoded in the page's own charset; link checks retry a
  refused `HEAD` as `GET` and check a page once for all its #fragments.
- Pages opened before the extension started show the HTTP status the page reports itself.
  "Reload page" on HTTP headers waits for the reload to finish. Prerendered links no longer
  replace the recorded response of the page on screen, and cookie values are never stored.
  A page its service worker answers says so instead of offering a reload that cannot help,
  and no longer shows the headers of the page before.
- Performance › Show on page works on every tab, follows scrolling and sticky elements, and
  outlines each shifted element once.

[Unreleased]: https://github.com/VitalSentinel/chrome-extension/compare/v1.0.9...HEAD
[1.0.9]: https://github.com/VitalSentinel/chrome-extension/releases/tag/v1.0.9
[1.0.8]: https://github.com/VitalSentinel/chrome-extension/releases/tag/v1.0.8
