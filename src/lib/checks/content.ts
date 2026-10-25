import type { Finding, PageSnapshot } from '../types';

export const metaValue = (s: PageSnapshot, key: string) =>
  s.meta.find((m) => m.key === key)?.content ?? null;

export const metaValues = (s: PageSnapshot, key: string) =>
  s.meta.filter((m) => m.key === key).map((m) => m.content);

export const TITLE_RANGE = [30, 60] as const;
export const DESCRIPTION_RANGE = [70, 160] as const;

/** Heading jumps such as H2 → H4, each reported once. */
export function headingSkips(headings: PageSnapshot['headings']): [number, number][] {
  const skips: [number, number][] = [];
  let prev = 0;
  for (const { level } of headings) {
    if (prev && level > prev + 1 && !skips.some(([a, b]) => a === prev && b === level)) {
      skips.push([prev, level]);
    }
    prev = level;
  }
  return skips;
}

export function contentFindings(s: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  const title = s.title;
  if (!title) out.push({ id: 'title.missing', level: 'bad' });
  else if (title.length < TITLE_RANGE[0])
    out.push({ id: 'title.short', level: 'warn', params: { n: title.length } });
  else if (title.length > TITLE_RANGE[1])
    out.push({ id: 'title.long', level: 'warn', params: { n: title.length } });
  else out.push({ id: 'title.ok', level: 'good', params: { n: title.length } });

  const description = metaValue(s, 'description');
  if (!description) out.push({ id: 'description.missing', level: 'warn' });
  else if (description.length < DESCRIPTION_RANGE[0])
    out.push({ id: 'description.short', level: 'warn', params: { n: description.length } });
  else if (description.length > DESCRIPTION_RANGE[1])
    out.push({ id: 'description.long', level: 'warn', params: { n: description.length } });
  else out.push({ id: 'description.ok', level: 'good', params: { n: description.length } });

  const h1 = s.headings.filter((h) => h.level === 1);
  if (!h1.length) out.push({ id: 'h1.missing', level: 'bad' });
  else if (h1.length > 1) out.push({ id: 'h1.multiple', level: 'warn', params: { n: h1.length } });
  else if (!h1[0].text) out.push({ id: 'h1.empty', level: 'warn' });

  for (const [from, to] of headingSkips(s.headings)) {
    out.push({ id: 'heading.skip', level: 'warn', params: { from, to } });
  }
  if (!s.lang) out.push({ id: 'lang.missing', level: 'warn' });
  if (!metaValue(s, 'viewport')) out.push({ id: 'viewport.missing', level: 'warn' });
  if (s.wordCount < 200)
    out.push({ id: 'content.thin', level: 'info', params: { n: s.wordCount } });
  return out;
}
