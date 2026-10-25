import { useMemo, useState } from 'preact/hooks';
import { num } from '../../lib/format';
import type { Level } from '../../lib/types';
import {
  Banner,
  Button,
  Card,
  ErrorNote,
  Loading,
  Note,
  Page,
  Pill,
  Section,
  Stats,
} from '../../ui/kit';
import { runAxe, useAsync, type AxeResult } from '../data';
import type { PageProps } from '../types';

const IMPACTS = ['critical', 'serious', 'moderate', 'minor'] as const;
type Impact = (typeof IMPACTS)[number];
const IMPACT: Record<Impact, [string, Level]> = {
  critical: ['Critical', 'bad'],
  serious: ['Serious', 'bad'],
  moderate: ['Moderate', 'warn'],
  minor: ['Minor', 'info'],
};
const impactOf = (impact: string): Impact =>
  (IMPACTS as readonly string[]).includes(impact) ? (impact as Impact) : 'minor';
const rank = (impact: string) => IMPACTS.indexOf(impactOf(impact));
const SHOWN_PASSES = 12;
const SHOWN_NODES = 5;
const plural = (n: number, more = '') => `${num(n)} ${more}${n === 1 ? 'element' : 'elements'}`;

/**
 * A long axe selector cut to its first step (often a unique id) and its tail (the element
 * itself): "#post-12 > … > li > a.more".
 */
export function shortSelector(target: string, max = 72): string {
  if (target.length <= max) return target;
  const parts = target.split(' > ');
  if (parts.length < 3) return target;
  const head = parts.shift()!;
  let tail = parts.pop()!;
  while (parts.length && head.length + tail.length + parts[parts.length - 1].length + 9 <= max)
    tail = `${parts.pop()} > ${tail}`;
  return `${head} > … > ${tail}`;
}

/** "#9ca3af on #ffffff · 2.5:1" from axe's colour contrast failure summary. */
function contrast(summary: string): string | null {
  const m =
    /contrast of ([\d.]+) \(foreground color: (#[\da-f]+), background color: (#[\da-f]+)/i.exec(
      summary,
    );
  return m ? `${m[2]} on ${m[3]} · ${m[1]}:1` : null;
}

function Issue({ v }: { v: AxeResult['violations'][number] }) {
  const [label, level] = IMPACT[impactOf(v.impact)];
  const shown = v.nodes.slice(0, SHOWN_NODES);
  return (
    <Card class="divide-y divide-hairline">
      <div class="flex items-start gap-3 px-4 py-2.5">
        <span class="shrink-0">
          <Pill level={level}>{label}</Pill>
        </span>
        <a
          class="min-w-0 flex-grow font-semibold text-ink"
          href={v.helpUrl}
          target="_blank"
          rel="noreferrer"
        >
          {v.help}
        </a>
        <span class="shrink-0 whitespace-nowrap text-ink-2">{plural(v.count)}</span>
      </div>
      {shown.map((n, i) => {
        const detail = contrast(n.summary);
        return (
          <div class="flex items-baseline gap-3 px-4 py-2" key={i}>
            <span
              class="mono line-clamp-2 min-w-0 flex-grow text-ink-2 [overflow-wrap:anywhere]"
              title={n.summary ? `${n.target}\n\n${n.summary}` : n.target}
            >
              {shortSelector(n.target)}
            </span>
            {detail && <span class="shrink-0 text-xs text-ink-2">{detail}</span>}
          </div>
        );
      })}
      {v.count > shown.length && (
        <div class="px-4 py-2 text-xs text-ink-3">+ {plural(v.count - shown.length, 'more ')}</div>
      )}
    </Card>
  );
}

export default function Accessibility({ ctx }: PageProps) {
  const [run, setRun] = useState(0);
  const axe = useAsync(() => runAxe(ctx.tabId, run > 0), [ctx.tabId, run]);
  const violations = useMemo(
    () => [...(axe.data?.violations ?? [])].sort((a, b) => rank(a.impact) - rank(b.impact)),
    [axe.data],
  );
  const stats = useMemo(
    () =>
      IMPACTS.map((key) => {
        const n = violations.filter((v) => impactOf(v.impact) === key).length;
        return { label: IMPACT[key][0], value: n, level: n ? IMPACT[key][1] : undefined };
      }),
    [violations],
  );

  const again = (
    <Button variant="primary" disabled={axe.loading} onClick={() => setRun((n) => n + 1)}>
      Run again
    </Button>
  );
  const passIds = axe.data?.passIds.slice(0, SHOWN_PASSES) ?? [];

  return (
    <Page title="Accessibility" aside={again}>
      {axe.loading ? (
        <Loading label="Running accessibility checks…" rows={5} />
      ) : axe.error || !axe.data ? (
        <ErrorNote>
          The accessibility checks could not run on this page{axe.error ? `: ${axe.error}` : '.'}
        </ErrorNote>
      ) : (
        <>
          <Stats items={stats} />

          <Section title={`Issues · ${violations.length}`}>
            {violations.length ? (
              violations.map((v) => <Issue v={v} key={v.id} />)
            ) : (
              <Banner level="good" title="No automated accessibility issues found" />
            )}
          </Section>

          <Section title={`Passed · ${num(axe.data.passes)} rules`}>
            {passIds.length ? (
              <div class="flex flex-wrap gap-1.5">
                {passIds.map((id) => (
                  <span
                    class="whitespace-nowrap rounded-pill bg-good-tint px-2.5 py-0.5 text-xs text-good-text"
                    key={id}
                  >
                    {id}
                  </span>
                ))}
                {axe.data.passes > passIds.length && (
                  <span class="whitespace-nowrap rounded-pill bg-hover px-2.5 py-0.5 text-xs text-ink-2">
                    + {num(axe.data.passes - passIds.length)} rules
                  </span>
                )}
              </div>
            ) : (
              <Note>No rules passed.</Note>
            )}
          </Section>
        </>
      )}
      <Note>
        Automated checks with axe-core find roughly a third of WCAG issues; keyboard and
        screen-reader testing still matter.
      </Note>
    </Page>
  );
}
