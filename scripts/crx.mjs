// Packs the store build (.output/chrome-mv3) into a signed CRX next to the store zip:
// .output/<name>-<version>-chrome.crx. The signing key lives in .keys/chrome.pem (git-ignored).
// The first run has Chromium create it; keep a backup, as the key fixes the CRX's extension ID
// and every later CRX must be signed with it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const dir = resolve('.output/chrome-mv3');
const key = resolve('.keys/chrome.pem');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

if (manifest.key) {
  console.error('The build carries the development key. Run STORE_BUILD=1 npm run zip first.');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'crx-'));
try {
  execFileSync(process.env.CHROME_PATH || chromium.executablePath(), [
    `--pack-extension=${dir}`,
    ...(existsSync(key) ? [`--pack-extension-key=${key}`] : []),
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-message-box',
  ]);
} finally {
  rmSync(profile, { recursive: true, force: true });
}

if (!existsSync(key)) {
  mkdirSync('.keys', { recursive: true });
  renameSync(`${dir}.pem`, key);
  console.log(`New signing key in ${key} – back it up; later CRX files must use it.`);
}
const out = resolve(`.output/${pkg.name}-${pkg.version}-chrome.crx`);
renameSync(`${dir}.crx`, out);
console.log(out);
