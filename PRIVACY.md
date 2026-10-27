# Privacy

This document describes what the VitalSentinel – SEO Extension stores in your browser and what
it sends, to whom and when. It covers version 1.x. If a change to the extension alters
anything below, this document changes in the same release and the change is listed in the
[CHANGELOG](CHANGELOG.md).

Last updated: October 27, 2026. Changes are announced in the CHANGELOG and, if they change what
leaves your browser, on the Terms screen before the next report.

## Principle

Your browser does the work. Everything that can be computed or fetched in the browser is: the
extension reads the page, its response headers and its redirect chain itself, and fetches
robots.txt, sitemaps and raw HTML straight from the site. No VitalSentinel server sits between
you and the page.

VitalSentinel's servers are called only for Domain Rating (while it is on), the monitoring
data of a signed-in user's own sites, sign-in itself, and the daily report of usage
and error counts, without an identifier (only if you turn them on).

## What leaves the browser

| Recipient                                             | What                                                                                                                                                                                                                                                                                    | When                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The site being viewed                                 | Ordinary requests for raw HTML, robots.txt, sitemaps, llms.txt, link status checks and its favicon (for the Google snippet preview, not in offline mode)                                                                                                                                | When you open a report that needs them                                                                                                                                                                                                                                           |
| Hosts named in the site's robots.txt or sitemap index | Ordinary requests for those sitemap files (often on the site's CDN); never local network names                                                                                                                                                                                          | When a report checks whether the page is in a sitemap (only the viewed host in offline mode)                                                                                                                                                                                     |
| Sites the page links to                               | A `HEAD` request per link (a `GET` when the server refuses `HEAD` with 400, 403, 405 or 501 or drops it; only the status is read, not the body)                                                                                                                                         | Only when you click "Check status" on the Links report (only links on the same host in offline mode)                                                                                                                                                                             |
| Hosts of the page's images                            | An ordinary image request for each thumbnail and the `og:image`, without a referrer                                                                                                                                                                                                     | When the Images or Social tags report is open (only images on the same host in offline mode)                                                                                                                                                                                     |
| VitalSentinel app                                     | Domain of the current tab (`blog.example.co.uk` is sent as `example.co.uk`), never the full URL                                                                                                                                                                                         | Only after you accept the Terms with Domain Rating on (its switch on the Terms screen starts on); never for incognito tabs or private network names; about once a week per domain (cached locally for 7 days; a failed lookup is retried after an hour); without a sign-in token |
| VitalSentinel app (signed in)                         | Requests for your name or e-mail, workspaces and roles, and your domain list                                                                                                                                                                                                            | Hourly at most (cached locally)                                                                                                                                                                                                                                                  |
| VitalSentinel app (signed in)                         | Full URL of the current tab, without its hash and tracking parameters (`utm_*`, `gclid`, `fbclid` and similar), to load its last 90 days of Google Search Console, Google index, CrUX and Web Analytics data, or to watch it; "Stop watching" sends only the watch ID                   | Only when the host matches one of your monitored domains; at most once an hour per page (cached for the browser session), or again when you click Refresh                                                                                                                        |
| VitalSentinel app (usage report)                      | Daily counters from a fixed list, the extension version, Chrome or Edge, production or development build, UI language, signed in yes/no and four settings as on/off – no token, no cookies, no identifier (see [Usage statistics and error counts](#usage-statistics-and-error-counts)) | Once a day for the days before today, only after you turn them on (both off by default); never in offline mode                                                                                                                                                                   |
| Ahrefs (from the app, not the browser)                | Domain                                                                                                                                                                                                                                                                                  | On a Domain Rating cache miss in the app                                                                                                                                                                                                                                         |

Links you click (Rich Results Test, Schema.org validator, PageSpeed Insights, "Start
monitoring") open those sites with the page address or host in the link, as any link would.

Nothing else is sent. In particular:

- **No browsing history is kept or sold.** Apart from the Domain Rating lookup (domain
  names only) and your own monitored sites when you are signed in, the extension sends nothing about the pages you visit. The daily report counts how often
  features were used, never where. There is no analytics library.
- **Error reports are counts only.** They say how often something failed, never a message, a
  stack trace, a page URL or page content.
- **The optional badge colouring sends nothing.** It colours the badge from the Core Web
  Vitals measured on your device for the current page load.

## Your consent

The first time you open the popup, it shows the Terms screen instead of a report. It asks you
to accept the VitalSentinel [Terms and Conditions](https://www.vitalsentinel.com/terms-and-conditions)
and to confirm you have read the [Privacy Policy](https://www.vitalsentinel.com/privacy-policy#browser-extension).
Until you do, nothing is looked up, counted or reported. A new version of the Terms asks again.

- **Domain Rating** – a switch, on to start with, that says the domain of each site you visit
  goes to VitalSentinel, which looks it up with Ahrefs. Turn it off and no lookup is ever made.
- **Usage statistics and error counts** need your consent – one switch for both,
  off until you turn it on, on the Terms screen or in Settings.

Accepting a newer version of the Terms keeps your choices.

Every choice can be changed in Settings › Data sources and privacy. Turning one off stops its
requests immediately, and turning off usage statistics or error reports also deletes their
counters that were not sent yet.

## Usage statistics and error counts

The extension keeps a few counters per UTC day in its own storage and, once a day, sends the
days before today to VitalSentinel (`POST /api/public/v1/extension/telemetry`). The first report
goes out the day after you accept the Terms. The request carries no sign-in token and no
cookies, so a report cannot be tied to your account, and there is no install ID or any other
identifier, so reports from the same browser cannot be linked to each other.

A report contains:

- the day (a date, no time), the extension version, Chrome or Edge, production or development build,
  the browser's UI language (two letters, e.g. `en`) and whether you are signed in (yes/no);
- with usage statistics on: whether four settings are on or off (Domain Rating, the DR badge,
  badge colouring and page history), and how often each of these happened that day: the popup or Settings was opened,
  each report tab was viewed, JavaScript was switched (popup, shortcut or menu), an accessibility scan, a link check or the vitals overlay was run, headers or JSON-LD
  were copied, sign-in, sign-out, "Watch this page", a VitalSentinel offer was clicked, the
  extension was installed or updated;
- with error reports on: how often a page analysis, a report, an accessibility scan,
  VitalSentinel data, sign-in, a Domain Rating lookup or a worker request failed.

Never part of a report: page or site addresses, titles or content, check results, Core Web
Vitals or Domain Rating values, account, workspace or domain IDs, e-mail addresses, cookies,
error messages or stack traces. Report views and actions in incognito tabs are not counted.
The full list of counter names is fixed in
[`src/lib/usage.ts`](src/lib/usage.ts); the app rejects any other name.

The app adds each report to daily totals (per version, browser, build and language), keeps those
totals for 12 months and does not store the report itself, your IP address or your user agent.
Reports are kept only as deidentified daily totals, and we do not attempt to re-identify them.
Reports are rate-limited with counters in Redis keyed by a daily-salted hash of the IP address,
which expire within a day. A report that cannot be sent is retried an hour later and deleted
after 7 days.

Like every request to vitalsentinel.com, report requests pass through Cloudflare and appear in
the web servers' access logs (IP address, browser and request line), kept for up to 60 days for
security, as the [Privacy Policy](https://www.vitalsentinel.com/privacy-policy) describes.
Nothing from them is stored with your IP address in our databases.

## Domain Rating

Domain Rating (DR) is the only Ahrefs data the extension uses, and it is shown with the
credit "Domain Rating by Ahrefs". The extension never talks to Ahrefs and never holds an
Ahrefs key. It asks the VitalSentinel app (`GET /api/public/v1/domain-rating`), which fetches DR
from Ahrefs and caches it per registrable domain for 7 days, so Ahrefs receives a domain name
only, and only on a cache miss.

Because lookups are proxied through the app, the app learns which domains are looked up. The
request carries no sign-in token, even when you are signed in, and the app stores no user or IP
address with the Domain Rating data:

- It stores only the DR row for the domain (domain, score, when it was fetched) and one
  lookup count per domain, used to decide which stale rows refresh first, plus daily totals of
  lookups kept for 12 months – never who asked.
- Lookups are rate-limited with hourly and daily counters in Redis, keyed by a daily-salted hash
  of the IP address rather than the address itself, that expire
  after an hour or a day.
- Like every other request to vitalsentinel.com, lookups pass through Cloudflare and appear in
  the web servers' access logs (IP address, browser and request line, which includes the
  domain), kept for up to 60 days for security. Nothing from them is stored with your IP
  address in our databases.

The extension caches each domain's DR locally for 7 days, so a domain you visit often is
looked up about once a week (a failed lookup is retried after an hour). Older entries are deleted, and turning off the lookup or the
badge deletes all of them. Private network names (`.lan`, `.corp`, `.internal`, `.home.arpa`
and similar), IP addresses and `localhost` are never looked up.

## Signing in

Signing in is optional. Every report except the VitalSentinel tab works without an account.

Sign-in uses the VitalSentinel app's OAuth 2.1 server with PKCE (S256) through
`chrome.identity.launchWebAuthFlow`. You log in and approve the requested scopes on the
VitalSentinel site, not in the extension.

- The access token is kept in `chrome.storage.session` (cleared when the browser closes).
- The refresh token is kept in `chrome.storage.local`. It is single-use and rotates on every
  refresh.
- **Tokens never reach a content script or the page.** Only the service worker holds them and
  only the service worker calls the app. The extension's local storage is closed to content
  scripts.
- Signing out revokes the token with the app and clears both. You can also revoke the
  extension in the app under connected apps.

When signed in, the extension fetches your list of monitored domains and compares the current
host with it locally. The full URL of the current tab is sent only when the host matches one
of those domains, to load that page's last 90 days of Google Search Console, Google index, CrUX
and Web Analytics data or to add it to page monitoring when you choose "Watch this page".
"Stop watching" sends only the watch's ID, to remove the page from page monitoring.

## Offline mode

Settings include an **Offline mode** switch. With it on, the extension makes no request except
to the host being viewed (the exact host, not other subdomains): no Domain Rating, no
VitalSentinel data, no sign-in or sign-out request and no usage report. Nothing
is counted while it is on, and counters not sent yet are deleted when you turn it on.

## What is stored in the browser

All of this stays on your device, in the extension's own storage:

| Data                                                                                                                                                                                                  | Where                    | How long                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Navigation record per tab: status, response headers (cookie values removed) and redirect hops of the page itself, and the Core Web Vitals measured for that page load                                 | `chrome.storage.session` | Replaced on the next navigation in the tab; cleared when the browser closes                                              |
| Last report page open per tab, with the page address it was for, so the popup reopens there                                                                                                           | `chrome.storage.session` | Until the tab closes or the browser closes                                                                               |
| Settings (including the Terms version you accepted) and JavaScript rules                                                                                                                              | `chrome.storage.local`   | Until you change or remove them, or uninstall                                                                            |
| Domain Rating cache per registrable domain                                                                                                                                                            | `chrome.storage.local`   | 7 days; all deleted when the lookup or badge is turned off                                                               |
| Signed in: your name or e-mail, workspaces and roles, monitored domains; when loading them failed, the time it failed                                                                                 | `chrome.storage.local`   | Refreshed hourly; deleted on sign-in, sign-out and when the server rejects your session                                  |
| Signed in: a monitored page's VitalSentinel data (Google Search Console, Google index, CrUX and Web Analytics for the last 90 days)                                                                   | `chrome.storage.session` | 1 hour, at most 50 pages; deleted on sign-in, sign-out, when the server rejects your session and when the browser closes |
| Usage and error counters per day (names and numbers only) and the time of the last report attempt                                                                                                     | `chrome.storage.local`   | Until sent the next day; at most 7 days                                                                                  |
| Access token                                                                                                                                                                                          | `chrome.storage.session` | 60 minutes, or until sign-out or the browser closes                                                                      |
| Refresh token                                                                                                                                                                                         | `chrome.storage.local`   | Until it is used, revoked or you sign out                                                                                |
| "Changed since your last visit" snapshots per URL (status, title, description, canonical, robots, H1, word count, schema types, hreflang and link counts) and an index of those URLs with their dates | `chrome.storage.local`   | Pruned to 30 days and 2,000 URLs whenever a page is analysed; deleted when you turn the history off or clear it          |

Uninstalling the extension deletes all of it.

## Permissions

The extension asks for broad host access because header capture, redirect tracing and raw HTML
fetches must work on any site. Each permission and its use is listed in
[docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Legal bases and recipients

| Processing                               | Legal basis (GDPR)                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Usage statistics and error counts        | Your consent (art. 6(1)(a); § 109(8) of the Slovak Act 452/2021; § 25(1) TDDDG), withdrawn in Settings |
| Domain Rating lookups                    | Providing the feature you keep on (art. 6(1)(b)); answer No or turn it off in Settings                 |
| Monitoring data while signed in          | Our contract with you (art. 6(1)(b))                                                                   |
| Rate limiting by IP address, access logs | Our legitimate interest in preventing abuse and keeping the service secure (art. 6(1)(f))              |

Recipients:

- **Ahrefs Pte. Ltd.** (Singapore) receives only a domain name from our server, never your IP
  address or any identifier.
- **Contabo** (hosting, EU) and **Cloudflare** (content delivery and security; EU-U.S. Data
  Privacy Framework or Standard Contractual Clauses) process requests to VitalSentinel on our
  behalf.

No decision about you is made automatically.

## Your rights

You can ask us for access to, correction, erasure or restriction of your personal data, object
to processing based on our legitimate interest, receive your data in a portable form, and
withdraw a consent at any time without affecting what was processed before. Most of the data
above never leaves your browser and is deleted by turning the feature off or uninstalling. You
can also complain to the Office for Personal Data Protection of the Slovak Republic (Úrad na
ochranu osobných údajov SR, Hraničná 12, 820 07 Bratislava, dataprotection.gov.sk).

The extension does not track you across sites, so browser Do-Not-Track signals do not change
what it does. Chrome's "Clear browsing data" does not clear extension storage; use Settings ›
Clear history, or uninstall.

## Chrome Web Store User Data Policy

VitalSentinel's use of information received through this extension adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. Data is used only to provide the extension's
user-facing features described above; it is never sold, never used for advertising or
creditworthiness, and never transferred except as described in this document.

## Controller and contact

The controller is mountain explorer, s. r. o. (VitalSentinel), Karpatské námestie 7770/10A,
831 06 Bratislava, Slovakia, company ID 53226119. Privacy questions and requests:
privacy@vitalsentinel.com. We have not appointed a data protection officer. The VitalSentinel
web app is covered by the [Privacy Policy](https://www.vitalsentinel.com/privacy-policy).
