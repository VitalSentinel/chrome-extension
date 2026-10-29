# Releasing

Releases follow [Semantic Versioning](https://semver.org/). The version in `package.json` is
the version in the manifest and in the stores.

- **Patch** (1.0.x) – bug fixes, no new permission or outbound request.
- **Minor** (1.x.0) – new features. A new permission or a new outbound request is at least a
  minor release and always updates [PRIVACY.md](../PRIVACY.md) and
  [PERMISSIONS.md](PERMISSIONS.md).
- **Major** (x.0.0) – a change users must act on, such as removing a feature or changing what
  data leaves the browser in a way that needs new consent.

A new permission makes Chrome disable the extension until the user accepts it, so add
permissions sparingly and say why in the release notes.

## Steps

The `/release` Claude Code skill walks through steps 1 to 4. Nothing is pushed, tagged or
uploaded without the owner's explicit go-ahead.

1. **Check the branch.** All changes for the release are merged into `main`, CI is green, and
   the working tree is clean.
2. **Bump the version** in `package.json` (`npm version <x.y.z> --no-git-tag-version`, which
   also updates `package-lock.json`).
3. **Stamp the changelog.** In `CHANGELOG.md`, rename `## [Unreleased]` to
   `## [x.y.z] – YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above it, and update the
   links at the bottom: `[Unreleased]` compares `vx.y.z...HEAD`, and `[x.y.z]` points to the
   release tag (first release) or compares it with the previous tag.
4. **Build and zip both browsers** with the store settings:

   ```sh
   npm run typecheck && npm run lint && npm test && npm run test:e2e
   STORE_BUILD=1 npm run zip
   STORE_BUILD=1 npm run zip -- -b edge
   npm run crx
   ```

   The zips land in `.output/`. `STORE_BUILD=1` drops the development `key`, so the stores
   assign their own IDs. Check each zip's `manifest.json`: no `key`, the right version.
   `npm run crx` packs the Chrome store build into `.output/<name>-<version>-chrome.crx`,
   signed with `.keys/chrome.pem` (git-ignored; the first run creates it). The Chrome Web Store
   takes only this CRX (see [Verified CRX uploads](#verified-crx-uploads)).

5. **Commit and tag** (owner's go-ahead): `chore(release): x.y.z` on a release branch, merged
   through a pull request, then tag `vx.y.z` on `main`.
6. **Upload** the Chrome CRX to the Chrome Web Store developer dashboard and the Edge zip to
   Partner Center. Update the listing, screenshots and permission justifications if they
   changed (justifications: [PERMISSIONS.md](PERMISSIONS.md#store-justifications)).
7. **Publish a GitHub release** for the tag with the changelog section as its notes and both
   zips attached.

## Verified CRX uploads

The Chrome Web Store item is opted in to verified CRX uploads: the dashboard accepts only a CRX
signed with `.keys/chrome.pem`, whose public key is registered there. A plain zip is rejected.

**Back up `.keys/chrome.pem`** outside this machine (a password manager or other secure storage).
It is git-ignored, so the working copy is the only one. If it is lost, no update can be published
until Google support resets the key. Never let `npm run crx` create a new key: a CRX signed with
any other key is rejected.

## Store IDs and sign-in

OAuth redirect URIs are matched exactly, one per extension ID. Before the first store release,
the Chrome Web Store and Edge Add-ons IDs must be registered on the app's extension OAuth client
as `https://<id>.chromiumapp.org/`, or sign-in fails in the store build.
