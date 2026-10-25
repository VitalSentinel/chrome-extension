// Build report and guard: prints the size of every file in the Chrome build and fails when
// a packed file pulls code, styles or fonts from the network (everything must be bundled).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.argv[2] ?? '.output/chrome-mv3';
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(root);

// Remote loads in HTML, CSS or JS. Plain URL strings (links shown to the user, API endpoints
// called with fetch) are fine; these patterns are the ones that load code or assets.
const REMOTE = [
  /<script[^>]+src=["']https?:/i,
  /<link[^>]+href=["']https?:/i,
  /@import\s+(url\()?["']?https?:/i,
  /url\(\s*["']?https?:\/\/(?!www\.w3\.org)/i,
  /importScripts\(\s*["']https?:/i,
  /import\(\s*["']https?:/i,
];

let total = 0;
let failed = false;
const rows = [];
for (const f of files) {
  const buf = readFileSync(f);
  total += buf.length;
  const rel = f.slice(root.length + 1);
  if (/\.(js|css|html)$/.test(f)) {
    const text = buf.toString('utf8');
    for (const re of REMOTE) {
      const m = re.exec(text);
      if (m) {
        failed = true;
        console.error(
          `remote resource in ${rel}: ${text.slice(Math.max(0, m.index - 20), m.index + 80)}`,
        );
      }
    }
    rows.push([rel, buf.length, gzipSync(buf).length]);
  } else rows.push([rel, buf.length, null]);
}
rows.sort((a, b) => b[1] - a[1]);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const [rel, size, gz] of rows)
  console.log(
    `${kb(size).padStart(10)}  ${gz === null ? ''.padStart(10) : kb(gz).padStart(10)} gz  ${rel}`,
  );
console.log(`${kb(total).padStart(10)}  total, ${files.length} files`);
if (failed) process.exit(1);
