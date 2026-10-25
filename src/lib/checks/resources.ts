import type { Finding, ResourceInfo } from '../types';
import { sameSite } from '../url';

const TEXTUAL = /\.(js|mjs|css|json|svg|html?)(\?|$)/i;

export interface ResourceAudit {
  renderBlocking: ResourceInfo[];
  uncompressed: ResourceInfo[];
  thirdParty: { host: string; bytes: number; count: number }[];
  totalBytes: number;
  thirdPartyBytes: number;
  findings: Finding[];
}

export function auditResources(resources: ResourceInfo[], pageUrl: string): ResourceAudit {
  const renderBlocking = resources.filter((r) => r.renderBlocking);
  // Same encoded and decoded size on a text file over 1 KB means it was served uncompressed.
  const uncompressed = resources.filter(
    (r) => TEXTUAL.test(r.url) && r.encodedSize > 1024 && r.encodedSize === r.decodedSize,
  );
  const hosts = new Map<string, { bytes: number; count: number }>();
  let totalBytes = 0;
  let thirdPartyBytes = 0;
  for (const r of resources) {
    const size = r.transferSize || r.encodedSize;
    totalBytes += size;
    if (sameSite(r.url, pageUrl)) continue;
    thirdPartyBytes += size;
    const host = new URL(r.url).hostname;
    const h = hosts.get(host) ?? { bytes: 0, count: 0 };
    h.bytes += size;
    h.count += 1;
    hosts.set(host, h);
  }
  const thirdParty = [...hosts]
    .map(([host, v]) => ({ host, ...v }))
    .sort((a, b) => b.bytes - a.bytes);

  const findings: Finding[] = [];
  if (renderBlocking.length)
    findings.push({
      id: 'res.renderBlocking',
      level: 'warn',
      params: { n: renderBlocking.length },
    });
  if (uncompressed.length)
    findings.push({ id: 'res.uncompressed', level: 'warn', params: { n: uncompressed.length } });
  if (totalBytes && thirdPartyBytes / totalBytes > 0.5) {
    findings.push({
      id: 'res.thirdPartyHeavy',
      level: 'warn',
      params: { share: Math.round((thirdPartyBytes / totalBytes) * 100) },
    });
  }
  return { renderBlocking, uncompressed, thirdParty, totalBytes, thirdPartyBytes, findings };
}
