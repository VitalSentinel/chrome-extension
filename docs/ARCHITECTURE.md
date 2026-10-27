# Architecture

The extension is one Manifest V3 build for Chrome and Edge, built with WXT. It has four
parts: a service worker, the popup, a tiny content script that runs on every page, and an
analyser that is injected into the tab only when the popup opens.

```
        site · VitalSentinel app
                              ▲
                              │ every network call; holds the tokens
                     ┌────────┴───────┐  typed messages  ┌──────────────────────┐
                     │ service worker │ ◄──────────────► │ popup / options page │
                     └────────┬───────┘                  └──────────────────────┘
                              │
   every page                 │                 only when the popup opens
   ─────────────────────────  │  ─────────────────────────────────────────────
   webRequest navigation      │  analyser (DOM snapshot), axe-core, overlays,
   record (observe only)      │  injected with scripting.executeScript
   web-vitals collector       │
   (content script, ~8 KB)    │
```

## Principles

- **The browser does the work.** Every check that can run in the browser does, from the DOM,
  the response headers and files fetched straight from the site. VitalSentinel's servers are
  called only for Domain Rating and for a signed-in user's monitoring data.
- **The service worker is the only part that talks to the network or holds tokens.** The popup
  and the options page are views over it. Content scripts and injected code never see tokens.
- **Cheap work in the background, heavy work on open.** What every page needs (the icon and
  the first screen) is ready before the popup opens. Everything else waits for the user.
- **Analysis is pure.** The functions in `src/lib/checks/` take a DOM snapshot and a navigation
  record and return a report. They make no `chrome.*` calls, so they are unit-tested without a
  browser and can later be shared with vitalsentinel.com's tool pages.

## Background vs on open

| In the background, for every top-level page                                                            | Only when the popup opens                                                                              |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Navigation record: status, headers and redirect hops of the main frame only (webRequest, observe only) | DOM analysis: content, headings, images, links, structured data, social tags, hreflang                 |
| On-device Core Web Vitals of the real load (web-vitals collector, reported until the tab is hidden)    | Raw HTML fetch and the raw vs rendered comparison                                                      |
| Domain Rating for the badge (cached 7 days per domain)                                                 | robots.txt and sitemap fetch and parsing                                                               |
| JavaScript rule and icon state                                                                         | Link status checks (HEAD, 6 at a time)                                                                 |
| Signed in: monitored-site match (cached domain list)                                                   | VitalSentinel url-overview for monitored sites (90 days of Search Console, index, CrUX, Web Analytics) |
| Opt-in badge colouring from the on-device Core Web Vitals (no request)                                 | axe-core, the LCP and layout-shift overlay, the resource audit                                         |
| Usage and error counters (no identifier), and the daily report of the days before today                |                                                                                                        |

## Parts

### Service worker (`src/entrypoints/background`, `src/background/`)

- Records each tab's top-level navigation with observe-only `webRequest` listeners
  (`src/background/navigation.ts`). Records are kept in memory and mirrored to
  `chrome.storage.session`, so a restarted worker keeps them. A page its service worker
  answers (from its cache or its own fetch) makes no main-frame request, so a top-frame commit
  whose URL the record does not match drops the record; the popup then names the service
  worker (the snapshot's `serviceWorker`, from Navigation Timing).
- Answers every request from the popup, options page and content script over one typed
  message protocol (`src/lib/messages.ts`).
- Owns every call that needs a token or runs in the background: the app API
  (`src/background/api.ts`) and Domain Rating (`src/background/dr.ts`). Offline mode and the
  Domain Rating consent are enforced here.
- Owns sign-in, tokens and refresh (see below).
- Counts usage and errors (`src/background/usage.ts`) from the fixed names in
  `src/lib/usage.ts`. Pages send `usage:count`; the worker drops unknown names, keeps one
  counter set per UTC day in `chrome.storage.local` and sends finished days to
  `/api/public/v1/extension/telemetry` without a token or cookies. It counts and sends only
  after the Terms are accepted, never in offline mode, and prunes a switch's counters when the
  switch is turned off.
- Sets the toolbar badge, the icon state, JavaScript rules (`contentSettings`) and the context
  menu.

### Popup (`src/entrypoints/popup`, `src/popup/`, `src/ui/`)

- Preact, 800 × 600 (Chrome's maximum). A sidebar of groups – This page, Your site, Tools –
  works as an accordion: opening a page expands its group in place to list the group's pages;
  opening a page in another group collapses the first.
- Each page is a lazily loaded chunk, so opening the popup loads only the shell and the page
  shown.
- On open it asks the worker for the tab context (`tab:context`), injects the analyser into the
  tab, and combines the snapshot with the navigation record.
- Site requests (raw HTML, robots.txt, sitemaps, llms.txt, link checks) are fetched by the
  popup itself (`src/popup/data.ts`); host permissions lift CORS. They are
  memoised for the popup's lifetime.

### Web-vitals collector (content script, every page)

- About 8 KB gzipped: the `web-vitals` attribution build and a message to the worker (`vitals:report`). It
  collects LCP, INP, CLS, TTFB and FCP for the real page load until the tab is hidden.
- It must stay this small. Nothing else runs on every page.

### Analyser and overlays (injected on open)

- `src/lib/snapshot.ts` runs in the tab's isolated world through `scripting.executeScript`. It
  reads the DOM and returns a serialisable `PageSnapshot`; it never changes the page.
- axe-core and the LCP and layout-shift overlay are injected the same way, only when their
  report or toggle is opened.

### Options page (`src/entrypoints/options`)

A full-page view over the same worker messages, for settings and the JavaScript rule list.

## Sign-in

The extension uses the VitalSentinel app's OAuth 2.1 server. There is no auth code in the
extension beyond the client side of that flow.

1. The worker creates a PKCE verifier, an S256 challenge and a state value, and calls
   `chrome.identity.launchWebAuthFlow` on the app's `/oauth/authorize` with the client ID,
   `redirect_uri = https://<extension-id>.chromiumapp.org/`, the resource, the scopes and the
   challenge.
2. The user logs in on the app's consent page and approves the scopes.
3. Chrome captures the redirect. The worker checks `state` and exchanges the code at
   `POST /oauth/token` with the verifier.
4. The access token (JWT, 60 minutes) goes to `chrome.storage.session`; the refresh token
   (90 days, single-use, rotating) to `chrome.storage.local`.
5. Every app call carries `Authorization: Bearer` and goes to `/api/public/v1`. A 401 triggers
   one refresh. Refreshes are never run concurrently: parallel callers wait for the one
   refresh in flight, because a rotating token used twice is revoked. A failed refresh clears
   both tokens and shows the signed-out state.
6. Sign-out calls `POST /oauth/revoke` and clears storage.

Scopes are read-only except `write:pages`, which "Watch this page" and "Stop watching" need. The
extension asks only for the scopes its reports read (workspaces, domains, Google Search Console,
indexing, CrUX, Web Analytics and pages); the full list is in `src/lib/config.ts`.

Redirect URIs are matched exactly, so the app registers one per extension ID: Chrome Web
Store, Edge Add-ons, and the fixed development ID `ppnfgofoagpedmdbggnmlfomgnhjljal`, which
the development build pins with the manifest `key` (see [DEVELOPMENT.md](DEVELOPMENT.md)).

## Domain Rating

Domain Rating is fetched from the app's `GET /api/public/v1/domain-rating?target=<host>`. The
app normalises the target to the registrable domain, serves it from its own 7-day cache and
calls Ahrefs only on a miss. The extension never talks to Ahrefs and never holds an Ahrefs key.

- The extension caches DR per domain for 7 days in `chrome.storage.local`.
- Anonymous calls are rate-limited per IP by the app; with a token they use the account's
  normal limits. Either way they cost 0 API credits.
- A stale value (`stale: true`) is shown as is; a 503 shows "DR unavailable".
- Every DR value carries the credit "Domain Rating by Ahrefs": in the icon tooltip and at the
  foot of the popup sidebar.

## VitalSentinel data

Signed in, the worker caches the user's monitored domains and matches the current host with
`www.` stripped. On a match the report pages call
`GET /domains/{id}/url-overview?url=…&fallback=domain&sections=search_console,indexing,crux,web_analytics,crawl&days=90`
through the worker, which caches the answer for an hour in `chrome.storage.session`. The data
sits where it belongs: Search Console on Content, the Google index on Indexability, CrUX on
Performance and Overview, and a summary on Overview and the VitalSentinel tab; the app has the
rest. Sections with no URL data are filled from domain-level data (marked `scope: domain`).
Account and domain lists are served from their cache at once and refreshed in the background
when older than an hour. Requests from the extension's OAuth client cost 0 API credits.

## Bundle size

The popup must open instantly and the content script runs on every page, so size is a design
constraint rather than an afterthought:

- Preact instead of React, and hand-written types instead of a runtime schema library.
- Report pages load lazily; axe-core (the largest dependency) is injected only when the
  Accessibility report opens.
- `npm run size` reports the size of each built entry point.

## Configuration

Endpoints and the OAuth client ID are build-time settings (`WXT_APP_URL`, `WXT_API_URL`,
`WXT_OAUTH_CLIENT_ID`), read in `src/lib/config.ts`. See [DEVELOPMENT.md](DEVELOPMENT.md).
