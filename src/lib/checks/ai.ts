import type { Level, PageSnapshot } from '../types';
import { metaValue, metaValues } from './content';
import { AI_CRAWLERS, isAllowed, type RobotsTxt } from './robots';
import { parseJsonLd } from './schema';

// How well AI agents and answer engines can read the page. Most AI crawlers do not run
// JavaScript, so the raw HTML matters more here than for Googlebot.

export interface AiCheck {
  id: string;
  level: Level;
  params?: Record<string, string | number>;
}

export interface AiInput {
  snapshot: PageSnapshot;
  raw: PageSnapshot | null;
  robots: RobotsTxt | null;
  llmsTxt: { bytes: number; links: number } | null;
  markdown: boolean; // a .md twin or text/markdown negotiation answered
  inSitemap: boolean | null;
}

export function aiReadiness(input: AiInput): { checks: AiCheck[]; passed: number } {
  const { snapshot: s, raw, robots } = input;
  const checks: AiCheck[] = [];

  checks.push(
    input.llmsTxt
      ? {
          id: 'ai.llmsTxt',
          level: 'good',
          params: { bytes: input.llmsTxt.bytes, links: input.llmsTxt.links },
        }
      : { id: 'ai.llmsTxtMissing', level: 'info' },
  );

  const blocked = robots ? AI_CRAWLERS.filter((bot) => !isAllowed(robots, bot, s.url).allowed) : [];
  checks.push(
    blocked.length
      ? {
          id: 'ai.crawlersBlocked',
          level: 'warn',
          params: { bots: blocked.join(', '), n: blocked.length },
        }
      : { id: 'ai.crawlersAllowed', level: 'good' },
  );

  const rawH1 = raw?.headings.some((h) => h.level === 1) ?? true;
  const rawWords = raw?.wordCount ?? s.wordCount;
  checks.push(
    !raw
      ? { id: 'ai.rawUnknown', level: 'info' }
      : !rawH1 || rawWords < s.wordCount * 0.5
        ? { id: 'ai.needsJs', level: 'warn', params: { raw: rawWords, rendered: s.wordCount } }
        : { id: 'ai.noJsNeeded', level: 'good' },
  );

  const types = [...new Set(parseJsonLd(s.jsonLd).items.map((i) => String(i['@type'])))];
  checks.push(
    types.length
      ? { id: 'ai.structured', level: 'good', params: { types: types.join(', ') } }
      : { id: 'ai.noStructured', level: 'warn' },
  );

  const tags = (Object.keys(s.semantic) as (keyof PageSnapshot['semantic'])[]).filter(
    (k) => s.semantic[k],
  );
  checks.push(
    tags.includes('main')
      ? { id: 'ai.semantic', level: 'good', params: { tags: tags.join(', ') } }
      : { id: 'ai.noMain', level: 'warn' },
  );

  const hasAuthor = !!metaValue(s, 'author') || s.jsonLd.some((j) => /"author"/.test(j));
  const hasDates =
    !!metaValue(s, 'article:modified_time') || s.jsonLd.some((j) => /"dateModified"/.test(j));
  checks.push(
    hasAuthor && hasDates
      ? { id: 'ai.authorDates', level: 'good' }
      : { id: 'ai.authorDatesMissing', level: 'info' },
  );

  checks.push(
    input.markdown ? { id: 'ai.markdown', level: 'good' } : { id: 'ai.noMarkdown', level: 'info' },
  );

  if (input.inSitemap !== null)
    checks.push(
      input.inSitemap
        ? { id: 'ai.inSitemap', level: 'good' }
        : { id: 'ai.notInSitemap', level: 'warn' },
    );

  const noai = [...metaValues(s, 'robots'), ...metaValues(s, 'googlebot')].some((v) =>
    /noai|noimageai/i.test(v),
  );
  checks.push(noai ? { id: 'ai.noaiSet', level: 'info' } : { id: 'ai.noaiNotSet', level: 'good' });

  checks.push({
    id: 'ai.size',
    level: s.htmlBytes > 2_000_000 ? 'warn' : 'good',
    params: { words: s.wordCount, kb: Math.round(s.htmlBytes / 1024) },
  });

  return { checks, passed: checks.filter((c) => c.level === 'good').length };
}

export function countLinks(markdown: string): number {
  return (markdown.match(/\]\(https?:\/\/[^)]+\)/g) ?? []).length;
}
