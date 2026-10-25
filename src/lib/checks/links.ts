import type { Finding, LinkInfo } from '../types';
import { sameSite } from '../url';

export interface LinkRow extends LinkInfo {
  internal: boolean;
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
}

export interface LinkSummary {
  rows: LinkRow[];
  internal: number;
  external: number;
  nofollow: number;
  unique: number;
  emptyText: number;
  findings: Finding[];
}

export function classifyLinks(links: LinkInfo[], pageUrl: string): LinkSummary {
  const rows = links.map((l) => {
    const rel = l.rel.split(/\s+/);
    return {
      ...l,
      internal: sameSite(l.href, pageUrl),
      nofollow: rel.includes('nofollow'),
      sponsored: rel.includes('sponsored'),
      ugc: rel.includes('ugc'),
    };
  });
  const internal = rows.filter((r) => r.internal).length;
  const nofollow = rows.filter((r) => r.nofollow).length;
  const emptyText = rows.filter((r) => !r.text).length;
  const findings: Finding[] = [];
  if (emptyText) findings.push({ id: 'links.emptyText', level: 'warn', params: { n: emptyText } });
  const internalNofollow = rows.filter((r) => r.internal && r.nofollow).length;
  if (internalNofollow)
    findings.push({ id: 'links.internalNofollow', level: 'warn', params: { n: internalNofollow } });
  const insecure = rows.filter(
    (r) => r.href.startsWith('http:') && pageUrl.startsWith('https:'),
  ).length;
  if (insecure) findings.push({ id: 'links.insecure', level: 'info', params: { n: insecure } });
  return {
    rows,
    internal,
    external: rows.length - internal,
    nofollow,
    unique: new Set(rows.map((r) => r.href)).size,
    emptyText,
    findings,
  };
}

export type LinkStatus = { status: number; location?: string } | { error: string };
