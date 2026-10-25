# Development

## Requirements

- Node 22 (`.nvmrc`; `nvm use` picks it up)
- Chrome 120 or later, or Edge 120 or later

## Setup

```sh
nvm use
npm ci          # also runs `wxt prepare`, which generates .wxt/ types
npm run dev     # opens a Chrome profile with the extension loaded and hot reload
```

`npm run dev:edge` does the same for Edge.

## Scripts

| Script               | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `npm run dev`        | Development build for Chrome with hot reload                       |
| `npm run dev:edge`   | Development build for Edge                                         |
| `npm run build`      | Production build for Chrome into `.output/chrome-mv3`              |
| `npm run build:edge` | Production build for Edge into `.output/edge-mv3`                  |
| `npm run zip`        | Build and zip for upload (add `-- -b edge` for Edge)               |
| `npm run crx`        | Pack the Chrome store build into a signed CRX (see RELEASING.md)   |
| `npm run typecheck`  | `tsc --noEmit`                                                     |
| `npm run lint`       | oxlint over `src` and `tests`                                      |
| `npm run format`     | Prettier over the repository                                       |
| `npm test`           | Unit tests (Vitest)                                                |
| `npm run test:watch` | Unit tests in watch mode                                           |
| `npm run test:e2e`   | Production build, then Playwright end-to-end tests                 |
| `npm run size`       | Size of each built entry point                                     |
| `npm run icons`      | Render the toolbar and store icons from `src/assets/logo-mark.svg` |

## Project layout

```
src/
  entrypoints/     WXT entry points: background, popup, options, content scripts
  background/      service worker modules (navigation records, auth, badge, …)
  popup/           popup shell and report pages
  ui/              shared Preact components
  lib/             pure analysis and helpers, no chrome.* calls
    checks/        one module per check (content, headers, robots, schema, …)
  assets/          logos
public/
  _locales/en/     manifest and context-menu strings (chrome.i18n)
  icon/            toolbar and store icons
tests/
  unit/            Vitest
  e2e/             Playwright with the unpacked build
scripts/           build helpers (icons, size)
```

## Configuration

Endpoints and the OAuth client are build-time settings. Development builds (`npm run dev`,
`npm run build:local`) talk to `http://localhost:3000`; production builds to the defaults
below. Put overrides in `.env.local` (not committed):

| Variable              | Default                         | Use                                     |
| --------------------- | ------------------------------- | --------------------------------------- |
| `WXT_APP_URL`         | `https://app.vitalsentinel.com` | App links (deep links, add-domain flow) |
| `WXT_API_URL`         | `https://app.vitalsentinel.com` | Public API and OAuth endpoints          |
| `WXT_OAUTH_CLIENT_ID` | `vitalsentinel-extension`       | OAuth client registered in the app      |

Example for a local app:

```sh
WXT_APP_URL=http://localhost:3000
WXT_API_URL=http://localhost:8000
```

Restart `npm run dev` after changing `.env.local`.

## Extension ID

The development build is pinned to the extension ID **`ppnfgofoagpedmdbggnmlfomgnhjljal`** by
the manifest `key` in `wxt.config.ts`. The app registers
`https://ppnfgofoagpedmdbggnmlfomgnhjljal.chromiumapp.org/` as an OAuth redirect URI, so
sign-in works against any environment from an unpacked build.

Store builds are made with `STORE_BUILD=1`, which drops the `key`: the Chrome Web Store and Edge
Add-ons assign their own IDs, and those are registered as separate redirect URIs.

## Testing

**Unit tests** (`tests/unit`, Vitest with happy-dom and WXT's fake browser). Analysis code in
`src/lib/` takes plain data and returns plain data, so most tests build a snapshot or a
navigation record and assert on the result. Every check module comes with tests.

**End-to-end tests** (`tests/e2e`, Playwright). `npm run test:e2e` builds the extension and
loads `.output/chrome-mv3` into Chromium. The fixture switches Domain Rating off and accepts
the Terms in the popup first, as a user would, so no test calls the app. `a11y.spec.ts` runs axe-core (WCAG 2.1 A and AA) on every popup page,
Settings and the Terms screen, in light and dark mode; a new page goes into
`tests/e2e/pages.ts` so both suites cover it. Extensions need a headed browser, so on Linux run
it under a virtual display:

```sh
npx playwright install --with-deps chromium   # once
xvfb-run -a npm run test:e2e                  # Linux / CI
npm run test:e2e                              # macOS, Windows
```

## Quality gates

Before opening a pull request:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

CI (`.github/workflows/ci.yml`) runs the same commands.

## Debugging

- Service worker: `chrome://extensions` › VitalSentinel › "Inspect views: service worker".
- Popup: right-click the popup › Inspect.
- Injected analyser and the content script: the page's DevTools, under the extension's
  context in the console's context selector.
- Storage: in the service worker's DevTools console, `await chrome.storage.local.get()` and
  `await chrome.storage.session.get()`.

## Conventions

- TypeScript strict mode; Prettier formatting (single quotes, 100 columns, trailing commas).
- Lint is oxlint, because typescript-eslint does not support TypeScript 7 yet.
- Production files stay under 1,000 lines.
- UI copy is plain English; check results are ids with their text in `src/i18n/findings.ts`, and
  manifest strings are in `public/_locales/en/messages.json`. English is the only locale for now.
- Popup and content script size matter: no heavy dependencies, report pages load lazily, and
  heavy work only runs when the popup opens. See [ARCHITECTURE.md](ARCHITECTURE.md).
- Use en dashes (–), never em dashes.
