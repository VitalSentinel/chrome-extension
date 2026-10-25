import { contentFindings } from '../lib/checks/content';
import { headerFindings } from '../lib/checks/headers';
import { hreflangFindings } from '../lib/checks/hreflang';
import { analyseImages } from '../lib/checks/images';
import { indexability } from '../lib/checks/indexability';
import { classifyLinks } from '../lib/checks/links';
import { redirectFindings } from '../lib/checks/redirects';
import { auditResources } from '../lib/checks/resources';
import { analyseSchema } from '../lib/checks/schema';
import { socialFindings } from '../lib/checks/social';
import type { TabContext } from '../lib/messages';
import type { Finding, PageSnapshot } from '../lib/types';
import type { PageKey } from './nav';

// Issue counts for the sidebar from checks that need no network. Pages whose checks fetch or
// inject (tracking, accessibility, AI readiness) get no badge until they have run.

export interface Count {
  n: number;
  bad: boolean;
}

const count = (findings: Finding[]): Count => ({
  n: findings.filter((f) => f.level === 'warn' || f.level === 'bad').length,
  bad: findings.some((f) => f.level === 'bad'),
});

export function pageCounts(snap: PageSnapshot, ctx: TabContext): Partial<Record<PageKey, Count>> {
  const vitalsBad = Object.values(ctx.vitals?.metrics ?? {}).filter(
    (m) => m && m.rating !== 'good',
  );
  return {
    content: count(contentFindings(snap)),
    schema: count(analyseSchema(snap.jsonLd).findings),
    social: count(socialFindings(snap)),
    images: count(analyseImages(snap.images).findings),
    indexability: count([...indexability(snap, ctx.nav, null).findings, ...hreflangFindings(snap)]),
    links: count(classifyLinks(snap.links, snap.url).findings),
    performance: {
      n: vitalsBad.length + count(auditResources(snap.resources, snap.url).findings).n,
      bad: vitalsBad.some((m) => m!.rating === 'poor'),
    },
    headers: ctx.nav?.status
      ? count([...headerFindings(ctx.nav), ...redirectFindings(ctx.nav)])
      : undefined,
  };
}

export function sum(counts: (Count | undefined)[]): Count {
  return counts.reduce<Count>((a, c) => (c ? { n: a.n + c.n, bad: a.bad || c.bad } : a), {
    n: 0,
    bad: false,
  });
}
