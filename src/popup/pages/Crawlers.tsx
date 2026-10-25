import { useMemo } from 'preact/hooks';
import {
  AI_CRAWLERS,
  SEARCH_CRAWLERS,
  isAllowed,
  robotsUnavailable,
  type RobotsRule,
  type RobotsTxt,
  type RobotsVerdict,
} from '../../lib/checks/robots';
import { bytes, num } from '../../lib/format';
import {
  Banner,
  Card,
  Loading,
  LinkButton,
  Note,
  Page,
  Pill,
  Section,
  Table,
  cx,
} from '../../ui/kit';
import { robots, useAsync } from '../data';
import type { PageProps } from '../types';

interface Row {
  name: string;
  verdict: RobotsVerdict;
}

/**
 * The robots.txt line of every Allow/Disallow rule. parseRobots keeps rules in file order and
 * starts a group at the first User-agent line, so walking the text the same way pairs them up.
 */
export function ruleLines(text: string, parsed: RobotsTxt): Map<RobotsRule, number> {
  const rules = parsed.groups.flatMap((g) => g.rules);
  const out = new Map<RobotsRule, number>();
  let inGroup = false;
  let k = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, '').trim());
    const key = m?.[1].toLowerCase();
    if (key === 'user-agent') inGroup = true;
    else if (inGroup && (key === 'allow' || key === 'disallow') && m![2].trim())
      out.set(rules[k++], i + 1);
  });
  return out;
}

/** "L4 Allow: /blog/", or without the line number when it is unknown. */
export const ruleText = (rule: RobotsRule, line?: number) =>
  `${line ? `L${line} ` : ''}${rule.allow ? 'Allow' : 'Disallow'}: ${rule.path}`;

const verdicts = (parsed: RobotsTxt, agents: string[], url: string): Row[] =>
  agents.map((name) => ({ name, verdict: isAllowed(parsed, name, url) }));

function CrawlerTable({ rows, lines }: { rows: Row[]; lines: Map<RobotsRule, number> }) {
  return (
    <Table
      rows={rows}
      rowLevel={(r) => (r.verdict.allowed ? undefined : 'bad')}
      columns={[
        {
          label: 'Crawler',
          width: '170px',
          render: (r) => <span class="font-medium">{r.name}</span>,
        },
        {
          label: 'Verdict',
          width: '90px',
          render: (r) => (
            <Pill level={r.verdict.allowed ? 'good' : 'bad'}>
              {r.verdict.allowed ? 'Allowed' : 'Blocked'}
            </Pill>
          ),
        },
        {
          label: 'Deciding rule',
          render: ({ verdict: { rule, allowed } }) =>
            rule ? (
              <span class={cx('mono break-all', allowed ? 'text-ink-2' : 'text-poor-text')}>
                {ruleText(rule, lines.get(rule))}
              </span>
            ) : (
              <span class="text-ink-3">No matching rule</span>
            ),
        },
      ]}
    />
  );
}

/** Lines that decide a verdict in the tables above, with the crawlers they decide. */
function deciders(rows: Row[], lines: Map<RobotsRule, number>) {
  const out = new Map<number, { allow: boolean; agents: string[] }>();
  for (const { name, verdict } of rows) {
    const line = verdict.rule && lines.get(verdict.rule);
    if (!line) continue;
    const d = out.get(line) ?? { allow: verdict.rule!.allow, agents: [] };
    d.agents.push(name);
    out.set(line, d);
  }
  return out;
}

const agentList = (agents: string[]) =>
  agents.length > 3 ? `${agents.slice(0, 2).join(', ')} +${agents.length - 2}` : agents.join(', ');

function RobotsFile({ lines, decide }: { lines: string[]; decide: ReturnType<typeof deciders> }) {
  return (
    <pre class="mono m-0 rounded-card border border-border bg-surface-inset py-2.5 leading-relaxed text-ink-2">
      {lines.map((line, i) => {
        const d = decide.get(i + 1);
        return (
          <span
            class={cx(
              'grid grid-cols-[36px_minmax(0,1fr)] px-3',
              d && (d.allow ? 'bg-good-tint text-good-text' : 'bg-poor-tint text-poor-text'),
            )}
            key={i}
          >
            <span class={cx('select-none', d ? 'opacity-70' : 'text-ink-3')}>{i + 1}</span>
            <span class="whitespace-pre-wrap break-all">
              <span
                class={
                  d ? 'font-bold' : line.trimStart().startsWith('#') ? 'text-ink-3' : undefined
                }
              >
                {line}
              </span>
              {d && (
                <span class="ml-3 font-sans text-2xs font-semibold">
                  ← {d.allow ? 'allows' : 'blocks'} {agentList(d.agents)}
                </span>
              )}
            </span>
          </span>
        );
      })}
    </pre>
  );
}

export default function Crawlers({ snap }: PageProps) {
  const origin = new URL(snap.url).origin;
  const state = useAsync(() => robots(origin), [origin]);
  const r = state.data;

  const search = useMemo(
    () => (r ? verdicts(r.parsed, SEARCH_CRAWLERS, snap.url) : []),
    [r, snap.url],
  );
  const ai = useMemo(() => (r ? verdicts(r.parsed, AI_CRAWLERS, snap.url) : []), [r, snap.url]);
  const lines = useMemo(() => (r?.text ? r.text.replace(/\n$/, '').split(/\r?\n/) : []), [r]);
  const ruleLine = useMemo(() => (r ? ruleLines(r.text, r.parsed) : new Map()), [r]);
  const decide = useMemo(() => deciders([...search, ...ai], ruleLine), [search, ai, ruleLine]);
  const blocked = (rows: Row[]) => rows.filter((x) => !x.verdict.allowed).length;

  return (
    <Page
      title="Crawlers"
      aside={<LinkButton href={`${origin}/robots.txt`}>Open robots.txt ↗</LinkButton>}
    >
      {state.loading ? (
        <Loading label="Reading robots.txt…" rows={5} />
      ) : !r ? (
        <Banner level="warn" title="robots.txt could not be fetched">
          The request failed or timed out, so crawler access is unknown.
        </Banner>
      ) : (
        <>
          {robotsUnavailable(r.status) ? (
            <Banner level="bad" title={`robots.txt answers HTTP ${r.status}`}>
              Google treats a server error on robots.txt as “block everything” until it can read the
              file again.
            </Banner>
          ) : r.status !== 200 ? (
            <Banner level="good" title={`No robots.txt (HTTP ${r.status})`}>
              Without a robots.txt every crawler may fetch every URL.
            </Banner>
          ) : null}

          <Section
            title="Search engines"
            aside={`${blocked(search)} of ${search.length} blocked for this URL`}
          >
            <CrawlerTable rows={search} lines={ruleLine} />
          </Section>

          <Section
            title="AI crawlers"
            aside={`${blocked(ai)} of ${ai.length} blocked for this URL`}
          >
            <CrawlerTable rows={ai} lines={ruleLine} />
          </Section>

          {r.status === 200 && (
            <Section
              title="robots.txt"
              aside={`${num(lines.length)} lines · ${bytes(r.text.length)}`}
            >
              {lines.length ? (
                <RobotsFile lines={lines} decide={decide} />
              ) : (
                <Note>robots.txt is empty – everything is allowed.</Note>
              )}
            </Section>
          )}

          <Section title={`Declared sitemaps · ${r.parsed.sitemaps.length}`}>
            {r.parsed.sitemaps.length ? (
              <Card class="divide-y divide-hairline">
                {r.parsed.sitemaps.map((url) =>
                  /^https?:/i.test(url) ? (
                    <a
                      class="mono block break-all px-4 py-2.5"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      key={url}
                    >
                      {url}
                    </a>
                  ) : (
                    <span class="mono block break-all px-4 py-2.5 text-ink-2" key={url}>
                      {url}
                    </span>
                  ),
                )}
              </Card>
            ) : (
              <Note>
                robots.txt declares no sitemap. A Sitemap line helps every crawler find your URLs.
              </Note>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
