# Permissions

Every permission the extension requests, and what it is used for. The manifest is generated
from `wxt.config.ts`. A change to any permission updates this file, [PRIVACY.md](../PRIVACY.md)
and the [CHANGELOG](../CHANGELOG.md) in the same pull request.

The extension asks for broad host access because header capture, redirect tracing and raw HTML
fetches must work on any site. In return it sends nothing about your browsing to VitalSentinel
except a domain name for Domain Rating and, when you are signed in, the URLs of your own
monitored sites.

| Permission                     | Why                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host_permissions: <all_urls>` | Read response headers and redirect hops of the main frame; fetch raw HTML, robots.txt, sitemaps and link status from the site; call the app from the worker without CORS |
| `webRequest`, `webNavigation`  | Status code, headers and the redirect chain of each top-level page load only – no subresources (observe only, no blocking)                                               |
| `contentSettings`              | JavaScript allow / block rules per site                                                                                                                                  |
| `cookies`                      | Tracking and consent scan: cookies the page set, with their flags                                                                                                        |
| `scripting`                    | Inject the analyser, axe-core and overlays into the current tab when the popup asks; only the small web-vitals collector runs on every page                              |
| `identity`                     | `launchWebAuthFlow` for sign-in                                                                                                                                          |
| `storage`                      | Settings, JavaScript rules, per-tab navigation records (session storage), tokens, change-history snapshots                                                               |
| `contextMenus`                 | JavaScript switch on right-click                                                                                                                                         |

## Content scripts

One content script is declared for every page: the web-vitals collector, about 8 KB gzipped. It
measures the Core Web Vitals of the page load and reports them to the service worker. It
reads nothing else from the page and makes no network request.

Everything else that runs in a page (the analyser, axe-core, the LCP and layout-shift overlay,
link highlighting) is injected with `scripting.executeScript` only when the popup asks for it.
Injected code runs in the extension's isolated world, reads the page and does not change it,
except for the overlays and highlights you turn on. One small probe for the Tech and tracking
report runs in the page's own world (`world: 'MAIN'`), because the globals and `dataLayer`
consent commands it reads are not visible from the isolated world; it only reads them.

## Outbound requests

The hosts the extension contacts, and when, are listed in
[PRIVACY.md › What leaves the browser](../PRIVACY.md#what-leaves-the-browser). Offline mode in
Settings blocks all of them except the site being viewed.

## Store justifications

The Chrome Web Store and Edge Add-ons ask for a justification per permission. Use the "Why"
column above, and for host access add: "The extension analyses whatever page the user is on.
It reads the main-frame response headers and redirect chain, and fetches robots.txt, sitemaps
and the raw HTML from that site, which requires access to all hosts."
