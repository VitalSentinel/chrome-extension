import { describe, expect, it } from 'vitest';
import { aiReadiness, countLinks, type AiInput } from '../../../src/lib/checks/ai';
import { parseRobots } from '../../../src/lib/checks/robots';
import { meta, snap } from '../fixtures';

const ready = snap({
  meta: meta({ author: 'Ada', 'article:modified_time': '2026-10-01' }),
  headings: [{ level: 1, text: 'Hello' }],
  wordCount: 1000,
  jsonLd: ['{"@type":"Article","headline":"Hello"}'],
  semantic: { main: true, article: true, nav: false, header: true, footer: false },
  htmlBytes: 50 * 1024,
});

const base: AiInput = {
  snapshot: ready,
  raw: ready,
  robots: parseRobots(''),
  llmsTxt: { bytes: 2048, links: 12 },
  markdown: true,
  inSitemap: true,
};
const byId = (input: AiInput) =>
  Object.fromEntries(aiReadiness(input).checks.map((c) => [c.id, c.level]));

describe('aiReadiness', () => {
  it('passes every check for a well-prepared page', () => {
    const r = aiReadiness(base);
    expect(r.checks).toEqual([
      { id: 'ai.llmsTxt', level: 'good', params: { bytes: 2048, links: 12 } },
      { id: 'ai.crawlersAllowed', level: 'good' },
      { id: 'ai.noJsNeeded', level: 'good' },
      { id: 'ai.structured', level: 'good', params: { types: 'Article' } },
      { id: 'ai.semantic', level: 'good', params: { tags: 'main, article, header' } },
      { id: 'ai.authorDates', level: 'good' },
      { id: 'ai.markdown', level: 'good' },
      { id: 'ai.inSitemap', level: 'good' },
      { id: 'ai.noaiNotSet', level: 'good' },
      { id: 'ai.size', level: 'good', params: { words: 1000, kb: 50 } },
    ]);
    expect(r.passed).toBe(10);
  });

  it('names the AI crawlers robots.txt blocks', () => {
    const robots = parseRobots(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /page',
    );
    const check = aiReadiness({ ...base, robots }).checks[1];
    expect(check).toEqual({
      id: 'ai.crawlersBlocked',
      level: 'warn',
      params: { bots: 'GPTBot, ClaudeBot', n: 2 },
    });
    expect(aiReadiness({ ...base, robots: null }).checks[1]?.id).toBe('ai.crawlersAllowed');
  });

  it('compares raw and rendered content', () => {
    expect(byId({ ...base, raw: null })['ai.rawUnknown']).toBe('info');
    expect(aiReadiness({ ...base, raw: { ...ready, headings: [] } }).checks[2]).toEqual({
      id: 'ai.needsJs',
      level: 'warn',
      params: { raw: 1000, rendered: 1000 },
    });
    expect(byId({ ...base, raw: { ...ready, wordCount: 499 } })['ai.needsJs']).toBe('warn');
    expect(byId({ ...base, raw: { ...ready, wordCount: 500 } })['ai.noJsNeeded']).toBe('good');
  });

  it('reports what a bare page lacks', () => {
    const bare = snap({ meta: meta({ robots: 'noai, noimageai' }), htmlBytes: 3_000_000 });
    const r = aiReadiness({
      snapshot: bare,
      raw: null,
      robots: null,
      llmsTxt: null,
      markdown: false,
      inSitemap: false,
    });
    expect(Object.fromEntries(r.checks.map((c) => [c.id, c.level]))).toEqual({
      'ai.llmsTxtMissing': 'info',
      'ai.crawlersAllowed': 'good',
      'ai.rawUnknown': 'info',
      'ai.noStructured': 'warn',
      'ai.noMain': 'warn',
      'ai.authorDatesMissing': 'info',
      'ai.noMarkdown': 'info',
      'ai.notInSitemap': 'warn',
      'ai.noaiSet': 'info',
      'ai.size': 'warn',
    });
    expect(r.passed).toBe(1);
  });

  it('finds author and dates in JSON-LD and skips the sitemap check when unknown', () => {
    const s = {
      ...ready,
      meta: [],
      jsonLd: ['{"@type":"BlogPosting","author":{"name":"Ada"},"dateModified":"2026-10-01"}'],
    };
    const r = byId({ ...base, snapshot: s, raw: s, inSitemap: null });
    expect(r['ai.authorDates']).toBe('good');
    expect(r['ai.inSitemap']).toBeUndefined();
    expect(r['ai.notInSitemap']).toBeUndefined();
  });
});

describe('countLinks', () => {
  it('counts absolute Markdown links', () => {
    expect(
      countLinks(
        '# Site\n- [Docs](https://a.com/docs): intro\n- [API](http://a.com/api)\n- [Rel](/rel)\n[bad](ftp://x)',
      ),
    ).toBe(2);
    expect(countLinks('')).toBe(0);
  });
});
