// Google snippet preview: desktop titles cut at about 600 px of Arial 20px, descriptions at
// about 920 px of Arial 14px (two lines). Widths are measured by the caller (canvas in the
// popup) so this stays testable.

export const TITLE_PX = 600;
export const DESCRIPTION_PX = 920;

export type Measure = (text: string) => number;

export function truncate(
  text: string,
  maxPx: number,
  measure: Measure,
): { text: string; cut: boolean; px: number } {
  const px = measure(text);
  if (px <= maxPx) return { text, cut: false, px };
  const words = text.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (measure(`${next} …`) > maxPx) break;
    out = next;
  }
  // No word fits (CJK or one long token): cut by characters instead.
  if (!out) {
    for (const ch of text) {
      if (measure(`${out}${ch} …`) > maxPx) break;
      out += ch;
    }
  }
  return { text: `${out} …`, cut: true, px };
}

/** Breadcrumb-style URL Google shows: host › path › segments. */
export function displayUrl(url: string): string {
  const u = new URL(url);
  const decode = (p: string) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const parts = u.pathname.split('/').filter(Boolean).map(decode);
  return [u.hostname, ...parts].join(' › ');
}
