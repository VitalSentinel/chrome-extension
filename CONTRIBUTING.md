# Contributing

Thanks for helping improve the VitalSentinel – SEO Extension. This document explains how to
report problems and propose changes.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

Open an issue with the [bug report](https://github.com/VitalSentinel/chrome-extension/issues/new?template=bug_report.yml) or
[feature request](https://github.com/VitalSentinel/chrome-extension/issues/new?template=feature_request.yml) template. For a bug, include
the extension version (`chrome://extensions`), the browser and version, and a public URL that
shows the problem if you can.

**Security problems are not reported in issues.** Email security@vitalsentinel.com, as
described in [SECURITY.md](SECURITY.md).

## Scope

Some things the extension deliberately does not do. Please check before proposing them:

- **Ahrefs data other than Domain Rating** (URL Rating, backlinks, keywords, traffic and the
  like). Domain Rating is the only Ahrefs data the extension will use.
- **Tracking of users**: usage statistics stay opt-in anonymous counters from a fixed list, and
  no new request may send browsing data off the device without a clear user benefit. See [PRIVACY.md](PRIVACY.md).
- **Heavy dependencies in the popup or content script.** The popup must open instantly and the
  content script runs on every page.

Features that need a real browser farm, such as full Lighthouse runs, belong on
vitalsentinel.com rather than in the extension.

For a larger change, open an issue first so we can agree on the approach before you write the
code.

## Development setup

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). In short:

```sh
nvm use        # Node 22
npm ci
npm run dev
```

## Making a change

1. Fork the repository and create a branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep the change focused: one problem per pull request, no unrelated reformatting.
3. Add or update unit tests. Analysis code in `src/lib/` is pure TypeScript and is tested
   without a browser.
4. Update the docs that describe what you changed (see the table below) and add an entry under
   `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
5. Run the checks:

   ```sh
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npm run test:e2e   # end-to-end with the unpacked build
   ```

6. Open a pull request against `main` and fill in the template.

| You changed…                                           | Also update…                                        |
| ------------------------------------------------------ | --------------------------------------------------- |
| a request to a new host, or what an existing one sends | `PRIVACY.md`, `docs/PERMISSIONS.md`, `CHANGELOG.md` |
| a permission in `wxt.config.ts`                        | `docs/PERMISSIONS.md`, `PRIVACY.md`, `CHANGELOG.md` |
| what is kept in `chrome.storage`                       | `PRIVACY.md`                                        |
| how the worker, popup and page scripts interact        | `docs/ARCHITECTURE.md`                              |
| a script, environment variable or tool version         | `docs/DEVELOPMENT.md`                               |

## Style

- TypeScript in strict mode. Formatting is Prettier (`npm run format`); linting is oxlint.
- Keep production files under 1,000 lines; split at natural seams.
- UI copy is plain English in the components; check results are ids whose text lives in
  `src/i18n/findings.ts`; manifest and context-menu strings are in
  `public/_locales/en/messages.json`.
- Use en dashes (–), never em dashes, in code, comments, copy and docs.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`<type>(scope): <description>`, imperative and lower case, no trailing period, subject at most
72 characters. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`, `deps`.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
