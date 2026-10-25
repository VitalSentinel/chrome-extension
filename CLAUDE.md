# Claude Code Instructions for the VitalSentinel extension

Chrome and Edge Manifest V3 extension: WXT 0.21, Preact 11, TypeScript 7, Tailwind 3.4, Vitest
5, Playwright, oxlint, Prettier. Public repository, MIT. This file holds the hard rules; reference
material lives in `docs/` and is read on demand:

- `docs/ARCHITECTURE.md` – worker, popup, content script, analyser; sign-in; DR; bundle size
- `docs/PERMISSIONS.md` – every permission and why
- `docs/DEVELOPMENT.md` – scripts, env vars, extension ID, tests
- `docs/RELEASING.md` – versioning and store releases
- `PRIVACY.md` – what is stored and what leaves the browser (a published claim)

## Working rules

**1. Think before coding.** State assumptions. If several interpretations exist, present them –
don't pick silently. If a simpler approach exists, say so. If something is unclear, stop and ask.

**2. Simplicity first.** Minimum code that solves the problem. No speculative features,
abstractions for single-use code, or configurability nobody asked for. A case well under ~0.05%
likely gets no defensive branch, retry or fallback – unless it touches security, privacy or
data deletion.

**3. Surgical changes.** Touch only what the task needs. Match existing style. Mention
unrelated dead code, don't delete it; remove orphans your change created.

**4. Goal-driven execution.** Turn the task into a check: a failing test first for a bug,
tests before and after for a refactor. For multi-step work, state `1. [step] → verify: [check]`.

## Git and PRs

- **Never commit or push to `main`.** Work on a branch (`feat/…`, `fix/…`, `docs/…`).
- **Never merge a PR** without the owner's explicit command.
- **Conventional Commits 1.0.0**, new commits only: `<type>(scope): <description>`,
  imperative, lower case, no trailing period, subject ≤72 chars (a hook blocks longer). Types:
  `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert` `deps`.
- **Open every PR as a draft** (`gh pr create --draft`) and **assign `mvstepanek`**.
- **No AI attribution, anywhere.** Commits and PRs are authored as the owner. No
  `Co-Authored-By` trailer, no "Generated with" footer, no session link, and no mention of
  Claude, Anthropic or AI in commit messages, PR titles or bodies, or issue comments.
  `.claude/settings.json` turns off the automatic attribution.

## Typography and files

- **En dashes (–), never em dashes (U+2014)** – code, comments, UI copy, docs, commits, PRs.
- **Hard cap: 1000 lines** per production `.ts`/`.tsx` file (tests and generated files exempt).
- Check results are ids with params; their English text lives in `src/i18n/findings.ts`, so a translation is one more object of that shape. Manifest strings live in `public/_locales/en/messages.json`. UI copy is plain English.

## Size and performance

The popup must open instantly and the content script runs on every page.

- **Popup stays tiny:** Preact (never React), report pages lazy-loaded, no heavy dependency.
  No runtime schema library – hand-written types. Check `npm run size` after adding a
  dependency or a page, and justify any growth in the PR.
- **The every-page content script stays minimal:** the web-vitals collector only. Nothing
  else is declared for `<all_urls>`.
- **Heavy work only when the popup opens:** analyser injection, raw HTML, robots.txt and
  sitemap fetches, link checks, axe-core and overlays. Background work per
  page is limited to the navigation record, the vitals report, DR for the badge and icon state.
- Analysis in `src/lib/` stays pure: no `chrome.*` calls, unit-tested without a browser.

## Privacy

What may leave the browser is fixed in `PRIVACY.md` › "What leaves the browser" and
`docs/PERMISSIONS.md`. Hard rules:

- Only the service worker holds tokens and calls the VitalSentinel API; the popup fetches site
  resources itself. **Tokens never reach a content script, injected code
  or the page.**
- VitalSentinel receives the registrable domain (DR) and, only for a signed-in user's
  monitored hosts, the full URL. Usage statistics and error reports are anonymous daily counters
  from the fixed list in `src/lib/usage.ts`, sent without a token or cookies – no identifier,
  URL, domain, message or result. A new counter updates `PRIVACY.md` and the app's allowlist.
- Every request except to the site being viewed must respect offline mode.
- **Any new outbound request, new data in a request, new stored data or new permission must
  update `PRIVACY.md`, `docs/PERMISSIONS.md` and `CHANGELOG.md` in the same PR.**
- Domain Rating is the only Ahrefs data, always shown with "Domain Rating by Ahrefs".

## Docs ship with the code

| You changed…                                         | Update…                                             |
| ---------------------------------------------------- | --------------------------------------------------- |
| an outbound request or what it sends                 | `PRIVACY.md`, `docs/PERMISSIONS.md`, `CHANGELOG.md` |
| a permission or content script in `wxt.config.ts`    | `docs/PERMISSIONS.md`, `PRIVACY.md`, `CHANGELOG.md` |
| what is kept in `chrome.storage`                     | `PRIVACY.md` (storage table)                        |
| worker / popup / script boundaries, sign-in, DR flow | `docs/ARCHITECTURE.md`                              |
| a script, env var, tool version or test setup        | `docs/DEVELOPMENT.md`                               |
| the release process                                  | `docs/RELEASING.md` and `.claude/skills/release`    |
| a user-visible feature                               | `README.md` feature list and `CHANGELOG.md`         |

## Quality gates

Run before every commit you hand over (`/precommit` does this):

```sh
npm run typecheck && npm run lint && npm test && npm run build
```

Before opening or marking a PR ready, also run `npm run test:e2e` (on Linux under
`xvfb-run -a`). Lint is oxlint because typescript-eslint does not support TypeScript 7 yet.
New analysis code comes with unit tests.

## Changelog

`CHANGELOG.md` follows Keep a Changelog 1.1.0 and SemVer. **Every user-visible change adds an
entry under `## [Unreleased]`** (Added, Changed, Deprecated, Removed, Fixed, Security) in the
same PR. `/release` stamps it with the version and date; never push or tag a release without
the owner's explicit OK.
