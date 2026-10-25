import type { Finding, ImageInfo } from '../types';

export interface ImageRow extends ImageInfo {
  format: string;
  oversized: boolean; // natural size well above 2x the rendered size
  issues: string[];
  savings: number; // estimated bytes saved by resizing and a modern format
}

const MODERN = new Set(['webp', 'avif', 'svg']);

export function formatOf(src: string): string {
  const data = /^data:image\/([a-z0-9.+-]+)/i.exec(src);
  if (data) return data[1].toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const path = src.split(/[?#]/)[0].toLowerCase();
  const ext = /\.([a-z0-9]+)$/.exec(path)?.[1] ?? '';
  return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * Rough savings: resizing to 2x the rendered box scales bytes by area; WebP saves about 30%
 * over JPEG/PNG. Only images whose size the page could read count.
 */
export function estimateSavings(img: ImageInfo, format: string): number {
  if (!img.bytes || format === 'svg') return 0;
  let bytes = img.bytes;
  const area = img.naturalWidth * img.naturalHeight;
  const target = 4 * img.renderedWidth * img.renderedHeight;
  if (area > 0 && target > 0 && area > target) bytes *= target / area;
  if (!MODERN.has(format)) bytes *= 0.7;
  return Math.max(0, Math.round(img.bytes - bytes));
}

export function analyseImages(images: ImageInfo[]): {
  rows: ImageRow[];
  findings: Finding[];
  savings: number;
} {
  const rows = images
    .filter((i) => i.src && !i.src.startsWith('data:image/gif'))
    .map((img) => {
      const format = formatOf(img.src);
      const oversized =
        img.renderedWidth > 0 &&
        img.naturalWidth > img.renderedWidth * 2.5 &&
        img.naturalWidth > 400;
      const issues: string[] = [];
      if (img.alt === null) issues.push('img.altMissing');
      if (!img.widthAttr || !img.heightAttr) issues.push('img.noDimensions');
      if (oversized) issues.push('img.oversized');
      if (format && !MODERN.has(format) && img.bytes > 20_000) issues.push('img.legacyFormat');
      if (img.aboveFold && img.loading === 'lazy') issues.push('img.lazyAboveFold');
      if (!img.aboveFold && img.loading !== 'lazy' && img.renderedWidth > 0)
        issues.push('img.notLazy');
      return { ...img, format, oversized, issues, savings: estimateSavings(img, format) };
    });
  const count = (id: string) => rows.filter((r) => r.issues.includes(id)).length;
  const findings: Finding[] = [];
  for (const [id, level] of [
    ['img.altMissing', 'warn'],
    ['img.noDimensions', 'warn'],
    ['img.oversized', 'warn'],
    ['img.legacyFormat', 'info'],
    ['img.lazyAboveFold', 'warn'],
    ['img.notLazy', 'info'],
  ] as const) {
    const n = count(id);
    if (n) findings.push({ id, level, params: { n } });
  }
  return { rows, findings, savings: rows.reduce((a, r) => a + r.savings, 0) };
}
