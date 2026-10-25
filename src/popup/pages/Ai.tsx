import { aiReadiness, countLinks } from '../../lib/checks/ai';
import { message } from '../../i18n/findings';
import { Card, ErrorNote, LEVEL_TEXT, Loading, Mark, Page, Section, cx } from '../../ui/kit';
import { Ring } from '../../ui/charts';
import { fetchText, rawSnapshot, robots, sitemapsIfChecked, useAsync } from '../data';
import type { PageProps } from '../types';
import type { Level } from '../../lib/types';

const LABELS: Record<string, string> = {
  'ai.llmsTxt': 'llms.txt',
  'ai.llmsTxtMissing': 'llms.txt',
  'ai.crawlersBlocked': 'AI crawler access',
  'ai.crawlersAllowed': 'AI crawler access',
  'ai.rawUnknown': 'Content without JavaScript',
  'ai.needsJs': 'Content without JavaScript',
  'ai.noJsNeeded': 'Content without JavaScript',
  'ai.structured': 'Structured data',
  'ai.noStructured': 'Structured data',
  'ai.semantic': 'Semantic HTML',
  'ai.noMain': 'Semantic HTML',
  'ai.authorDates': 'Author and dates',
  'ai.authorDatesMissing': 'Author and dates',
  'ai.markdown': 'Markdown version',
  'ai.noMarkdown': 'Markdown version',
  'ai.inSitemap': 'Sitemap',
  'ai.notInSitemap': 'Sitemap',
  'ai.noaiSet': 'noai / noimageai',
  'ai.noaiNotSet': 'noai / noimageai',
  'ai.size': 'Page size for agents',
};

const ROW_TINT: Partial<Record<Level, string>> = { warn: 'bg-warn-tint', bad: 'bg-poor-tint' };

async function llmsTxt(origin: string) {
  const r = await fetchText(`${origin}/llms.txt`).catch(() => null);
  return r?.status === 200 && !/html/i.test(r.contentType)
    ? { bytes: r.text.length, links: countLinks(r.text) }
    : null;
}

/** A .md twin of the URL, else text/markdown content negotiation – both as HEAD requests. */
async function hasMarkdown(url: string): Promise<boolean> {
  const twin = new URL(url);
  twin.hash = '';
  twin.pathname = twin.pathname === '/' ? '/index.md' : `${twin.pathname.replace(/\/$/, '')}.md`;
  const md = await fetchText(twin.href, { method: 'HEAD' }).catch(() => null);
  if (md?.status === 200 && /markdown|text\/plain/i.test(md.contentType)) return true;
  const neg = await fetchText(url, { method: 'HEAD', headers: { Accept: 'text/markdown' } }).catch(
    () => null,
  );
  return !!neg && /text\/markdown/i.test(neg.contentType);
}

function verdict(passed: number, total: number): string {
  const share = total ? passed / total : 0;
  if (share >= 0.8) return 'AI agents can read this page well';
  if (share >= 0.5) return 'AI agents can read most of this page';
  return 'AI agents will struggle with this page';
}

export default function Ai({ snap, go }: PageProps) {
  const url = snap.url;
  const origin = new URL(url).origin;
  const state = useAsync(async () => {
    const [raw, robotsTxt, sitemap, llms, markdown] = await Promise.all([
      rawSnapshot(url).catch(() => null),
      robots(origin),
      sitemapsIfChecked(url),
      llmsTxt(origin),
      hasMarkdown(url),
    ]);
    return aiReadiness({
      snapshot: snap,
      raw: raw?.snapshot ?? null,
      robots: robotsTxt?.parsed ?? null,
      llmsTxt: llms,
      markdown,
      inSitemap: sitemap?.listed ?? null,
    });
  }, [url]);

  if (state.loading)
    return (
      <Page title="AI readiness">
        <Loading label="Checking what AI agents can read…" rows={5} />
      </Page>
    );
  if (state.error || !state.data)
    return (
      <Page title="AI readiness">
        <ErrorNote>AI readiness could not be checked: {state.error}</ErrorNote>
      </Page>
    );

  const { checks, passed } = state.data;
  const warnings = checks.filter((c) => c.level === 'warn' || c.level === 'bad').length;
  const tips = checks.filter((c) => c.level === 'info').length;

  return (
    <Page title="AI readiness">
      <Card class="flex items-center gap-4 px-5 py-4">
        <Ring value={passed} max={checks.length} />
        <div class="flex flex-col gap-0.5">
          <span class="text-[15px] font-bold">{verdict(passed, checks.length)}</span>
          <span class="text-ink-2">
            {passed} of {checks.length} checks passed · {warnings} to fix · {tips} optional
          </span>
        </div>
      </Card>

      <Section title="Checks">
        <Card class="divide-y divide-hairline overflow-hidden">
          {checks.map((c) => (
            <div
              class={cx(
                'grid grid-cols-[16px_180px_minmax(0,1fr)] items-start gap-3 px-4 py-2.5',
                ROW_TINT[c.level],
              )}
              key={c.id}
            >
              <Mark level={c.level} />
              <span class="font-medium">{LABELS[c.id] ?? c.id}</span>
              <span
                class={cx(
                  'min-w-0 break-words',
                  c.level === 'warn' || c.level === 'bad' ? LEVEL_TEXT[c.level] : 'text-ink-2',
                )}
              >
                {message(c)}
                {c.id === 'ai.crawlersBlocked' && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      class="text-accent-text hover:underline"
                      onClick={() => go('crawlers')}
                    >
                      Crawlers ›
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </Card>
      </Section>
    </Page>
  );
}
