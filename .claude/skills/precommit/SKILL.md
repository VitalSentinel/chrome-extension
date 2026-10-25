---
name: precommit
description: 'Local gate before a commit or push – typecheck, lint, unit tests and a production build – returning a GO/NO-GO verdict with the failures. Report only; it does not fix.'
when_to_use: 'Before committing or pushing, or when asked to "run the checks", "is this ready" or "run pre-commit".'
argument-hint: '[--e2e]'
---

# /precommit – typecheck, lint, test, build

Run the four gates CI runs and report one verdict. Do not fix anything unless asked.

## Steps

1. If nothing changed (`git status --short` is empty and `git diff --name-only main...HEAD` is
   empty), report "Nothing to check" and stop.
2. Run each gate from the repository root and capture the output. Run all four even if one
   fails, so the report is complete:

   ```sh
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

3. With `--e2e`, also run `npm run test:e2e` (prefix `xvfb-run -a` on Linux).
4. Check the diff for two rules no tool enforces:
   - em dashes (U+2014) in changed lines:
     `git diff main... | grep -n "^+.*$(printf '\342\200\224')"`
   - an outbound request, permission or stored data change without matching edits to
     `PRIVACY.md`, `docs/PERMISSIONS.md` and `CHANGELOG.md`
5. Report:

   ```
   ## Precommit: GO / NO-GO

   | Gate      | Result    | Notes                         |
   |-----------|-----------|-------------------------------|
   | typecheck | PASS/FAIL | first errors with file:line   |
   | lint      | PASS/FAIL | error count, first errors     |
   | test      | PASS/FAIL | passed/failed, failing tests  |
   | build     | PASS/FAIL | error, or entry sizes if shown|
   | e2e       | PASS/FAIL/skipped |                       |

   ### Blockers
   - …

   ### Warnings
   - em dashes, missing docs or CHANGELOG entry, oxlint warnings
   ```

NO-GO on any failed gate. Warnings alone are GO with notes. Never report GO while a gate fails.
