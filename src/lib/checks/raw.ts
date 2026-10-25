import type { Finding, PageSnapshot } from '../types';
import { metaValue } from './content';

// Raw HTML (what a non-rendering crawler gets) against the rendered DOM (what a browser and
// Googlebot's renderer see). Both sides come from collectSnapshot.

export interface RawDiffRow {
  field: string;
  raw: string;
  rendered: string;
  differs: boolean;
}

const h1 = (s: PageSnapshot) =>
  s.headings
    .filter((h) => h.level === 1)
    .map((h) => h.text)
    .join(' | ');

export function compareRaw(
  raw: PageSnapshot,
  rendered: PageSnapshot,
): { rows: RawDiffRow[]; findings: Finding[] } {
  const pick: [string, (s: PageSnapshot) => string][] = [
    ['title', (s) => s.title],
    ['description', (s) => metaValue(s, 'description') ?? ''],
    ['robots', (s) => metaValue(s, 'robots') ?? ''],
    ['canonical', (s) => s.canonicals.join(' ')],
    ['h1', h1],
    ['words', (s) => String(s.wordCount)],
    ['links', (s) => String(s.links.length)],
    ['jsonLd', (s) => String(s.jsonLd.length)],
    ['hreflang', (s) => String(s.hreflang.length)],
  ];
  const rows = pick.map(([field, f]) => {
    const a = f(raw);
    const b = f(rendered);
    // Counts drift with rotating widgets, ads and consent banners; only a real gap differs.
    const differs =
      field === 'words'
        ? Math.abs(Number(a) - Number(b)) > Math.max(50, Number(b) * 0.2)
        : field === 'links'
          ? Math.abs(Number(a) - Number(b)) > Math.max(5, Number(b) * 0.1)
          : a !== b;
    return { field, raw: a, rendered: b, differs };
  });
  const findings: Finding[] = [];
  const changed = (f: string) => rows.find((r) => r.field === f)!.differs;
  for (const f of ['title', 'description', 'robots', 'canonical']) {
    if (changed(f))
      findings.push({
        id: 'raw.changedByJs',
        level: f === 'robots' || f === 'canonical' ? 'bad' : 'warn',
        params: { field: f },
      });
  }
  if (!h1(raw) && h1(rendered)) findings.push({ id: 'raw.h1OnlyRendered', level: 'warn' });
  if (changed('words'))
    findings.push({
      id: 'raw.contentByJs',
      level: 'warn',
      params: { raw: raw.wordCount, rendered: rendered.wordCount },
    });
  if (changed('links') && raw.links.length < rendered.links.length / 2) {
    findings.push({
      id: 'raw.linksByJs',
      level: 'warn',
      params: { raw: raw.links.length, rendered: rendered.links.length },
    });
  }
  return { rows, findings };
}
