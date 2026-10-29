---
name: release
description: "Prepare a release locally – bump the version in package.json, stamp the CHANGELOG Unreleased section with the version and date, and build and zip Chrome and Edge (development and STORE_BUILD=1 store zips) and pack the signed Chrome CRX. Never pushes, tags or uploads without the owner's explicit OK."
when_to_use: 'When asked to "cut a release", "prepare 1.x.y" or "build the store zips".'
argument-hint: '<major|minor|patch|x.y.z>'
---

# /release – prepare a version

Full process: `docs/RELEASING.md`. This skill covers the local part only.

## Steps

1. **Preconditions.** Working tree clean (`git status --short` empty), on a release branch, not
   `main`. `CHANGELOG.md` has a non-empty `## [Unreleased]` section. If either fails, stop and
   say why.
2. **Pick the version.** Use the argument; for `major|minor|patch`, compute it from
   `package.json`. Check the choice against the Unreleased entries (a new permission or
   outbound request is at least minor). If they disagree, ask.
3. **Bump.** `npm version <x.y.z> --no-git-tag-version` (updates `package.json` and
   `package-lock.json`).
4. **Stamp the changelog.** Rename `## [Unreleased]` to `## [x.y.z] – YYYY-MM-DD` (today's date
   from the session context; en dash), add an empty `## [Unreleased]` above it, and update the
   links at the bottom (`[Unreleased]` compares `vx.y.z...HEAD`; `[x.y.z]` points to the tag).
5. **Gates.** `npm run typecheck && npm run lint && npm test && npm run test:e2e`. Stop on a
   failure.
6. **Build both browsers.**

   ```sh
   npm run zip && npm run zip -- -b edge                         # development key, local testing
   mkdir -p .output/dev && mv .output/*.zip .output/dev/         # same file names as the store zips
   STORE_BUILD=1 npm run zip && STORE_BUILD=1 npm run zip -- -b edge   # store uploads
   npm run crx                                                   # signed CRX of the Chrome store build
   ```

   Confirm each store zip's manifest (`unzip -p <zip> manifest.json`): no `key`, `version` is
   x.y.z.

   The Chrome Web Store takes only the CRX (verified uploads). If `npm run crx` says it created
   a new signing key, stop: `.keys/chrome.pem` is missing, and the CRX will be rejected. Restore
   the key from its backup.

7. **Report** the version, the changelog section, the zip and CRX paths and sizes, and the commands
   still to run. **Stop here.** Committing (`chore(release): x.y.z`), pushing, opening the PR,
   tagging `vx.y.z` and uploading to the stores each need the owner's explicit OK.
