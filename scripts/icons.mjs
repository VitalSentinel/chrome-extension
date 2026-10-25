// Renders the toolbar and store icons from the app's logo mark (src/assets/logo-mark.svg):
// the normal mark and a grey one for "JavaScript blocked".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const mark = readFileSync('src/assets/logo-mark.svg', 'utf8');
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const variants = {
  '': inner,
  'off-': inner.replace('#9333EA', '#A8A29E'),
};
mkdirSync('public/icon', { recursive: true });
for (const [prefix, body] of Object.entries(variants)) {
  for (const size of prefix ? [16, 32] : [16, 32, 48, 128]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56" fill="none">${body}</svg>`;
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
    writeFileSync(`public/icon/${prefix}${size}.png`, png);
  }
}
console.log('icons written to public/icon');
