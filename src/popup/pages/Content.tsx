import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  contentFindings,
  DESCRIPTION_RANGE,
  metaValue,
  TITLE_RANGE,
} from '../../lib/checks/content';
import {
  DESCRIPTION_PX,
  displayUrl,
  TITLE_PX,
  truncate,
  type Measure,
} from '../../lib/checks/serp';
import { date, num } from '../../lib/format';
import type { Level } from '../../lib/types';
import { Card, cx, Findings, KeyValues, LEVEL_TEXT, Page, Section } from '../../ui/kit';
import { appView, SearchConsole, useAppOverview } from '../appData';
import type { PageProps } from '../types';

// Text widths as Google renders them, measured on one shared offscreen canvas.
const canvas = new OffscreenCanvas(1, 1).getContext('2d')!;
const measureWith =
  (font: string): Measure =>
  (text) => {
    canvas.font = font;
    return canvas.measureText(text).width;
  };
const measureTitle = measureWith('20px Arial');
const measureDescription = measureWith('14px Arial');

const lengthLevel = (n: number, [min, max]: readonly [number, number]): Level =>
  !n ? 'bad' : n < min || n > max ? 'warn' : 'good';

const BAR: Record<Level, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-poor',
  info: 'bg-accent',
};

/** Title or description with its length and how much of Google's width it takes. */
function Length({
  label,
  text,
  px,
  maxPx,
  cut,
  range,
  missing,
}: {
  label: string;
  text: string;
  px: number;
  maxPx: number;
  cut: boolean;
  range: readonly [number, number];
  missing: string;
}) {
  const level = cut ? 'warn' : lengthLevel(text.length, range);
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-baseline gap-x-2.5">
        <h2 class="flex-grow text-sm font-bold">{label}</h2>
        {text && (
          <span class={cx('text-xs font-semibold', LEVEL_TEXT[level])}>
            {num(text.length)} characters · {num(Math.round(px))} of {num(maxPx)} px
            {cut && ' – cut in search results'}
          </span>
        )}
      </div>
      {text ? (
        <p class={cx('break-words', label === 'Description' ? 'text-ink-2' : 'text-[14px]')}>
          {text}
        </p>
      ) : (
        <p class="font-semibold text-poor-text">{missing}</p>
      )}
      <div class="h-1 overflow-hidden rounded-pill bg-track">
        <div
          class={cx('h-full rounded-pill', BAR[level])}
          style={{ width: `${Math.min(100, (px / maxPx) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** The site's favicon in Google's circle, or the empty circle (offline, or none found). */
function Favicon({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[#dadce0] bg-[#f1f3f4] dark:border-[#3c4043] dark:bg-[#303134]">
      {src && !broken && (
        <img
          src={src}
          alt=""
          referrerpolicy="no-referrer"
          class="h-[18px] w-[18px] rounded-sm"
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}

/** Where Google's cut falls, as the last few words that still show. */
const cutAfter = (text: string) => text.replace(/ …$/, '').split(' ').slice(-3).join(' ');

export default function Content({ ctx, snap, settings }: PageProps) {
  const overview = useAppOverview(ctx, snap.url);
  const findings = useMemo(() => contentFindings(snap), [snap]);

  const serp = useMemo(() => {
    const description = metaValue(snap, 'description') ?? '';
    const u = new URL(snap.url);
    return {
      favicon: settings.offline ? '' : `${u.origin}/favicon.ico`,
      url: `${u.protocol}//${displayUrl(snap.url)}`,
      site: metaValue(snap, 'og:site_name') || u.hostname,
      description,
      titleCut: truncate(snap.title, TITLE_PX, measureTitle),
      descriptionCut: truncate(description, DESCRIPTION_PX, measureDescription),
    };
  }, [snap, settings.offline]);

  const rows = useMemo((): [ComponentChildren, ComponentChildren, Level?][] => {
    const m = (k: string) => metaValue(snap, k);
    const viewport = m('viewport');
    const optional: [string, string | null][] = [
      ['Author', m('author') || m('article:author')],
      ['Published', m('article:published_time')],
      ['Modified', m('article:modified_time')],
    ];
    return [
      ['Language', snap.lang || 'Missing', snap.lang ? undefined : 'warn'],
      ['Words', num(snap.wordCount)],
      ...optional
        .filter(([, v]) => v)
        .map(([k, v]): [string, string] => [k, k === 'Author' ? v! : date(v!)]),
      [
        'Viewport',
        viewport ? <span class="mono break-words">{viewport}</span> : 'Missing',
        viewport ? undefined : 'warn',
      ],
    ];
  }, [snap]);

  const outline = useMemo(() => {
    let prev = 0;
    const perLevel = [0, 0, 0, 0, 0, 0];
    const items = snap.headings.map((h) => {
      const skip = prev && h.level > prev + 1 ? prev : 0;
      prev = h.level;
      perLevel[h.level - 1] = (perLevel[h.level - 1] ?? 0) + 1;
      return { ...h, skip };
    });
    const summary = perLevel
      .map((n, i) => (n ? `H${i + 1} ${n}` : ''))
      .filter(Boolean)
      .join(' · ');
    return { items, summary };
  }, [snap]);

  const { titleCut, descriptionCut } = serp;
  const cuts = [
    titleCut.cut && `Title is cut after "${cutAfter(titleCut.text)}" in desktop results.`,
    descriptionCut.cut &&
      `Description is cut after "${cutAfter(descriptionCut.text)}" in desktop results.`,
  ].filter(Boolean);

  return (
    <Page title="Content">
      <Findings items={findings} />

      <section class="flex flex-col gap-[18px]">
        <Length
          label="Title"
          text={snap.title}
          px={titleCut.px}
          maxPx={TITLE_PX}
          cut={titleCut.cut}
          range={TITLE_RANGE}
          missing="No title tag"
        />
        <Length
          label="Description"
          text={serp.description}
          px={descriptionCut.px}
          maxPx={DESCRIPTION_PX}
          cut={descriptionCut.cut}
          range={DESCRIPTION_RANGE}
          missing="No meta description"
        />
      </section>

      <Section title="Google snippet preview" aside="Desktop">
        <Card class="flex flex-col gap-1 px-4 py-3.5">
          <div class="flex flex-col gap-1" style={{ fontFamily: 'Arial, sans-serif' }}>
            <div class="flex min-w-0 items-center gap-2.5">
              <Favicon src={serp.favicon} key={serp.favicon} />
              <span class="flex min-w-0 flex-col leading-tight">
                <span class="truncate text-[14px] text-[#202124] dark:text-[#dadce0]">
                  {serp.site}
                </span>
                <span class="truncate text-xs text-[#4d5156] dark:text-[#bdc1c6]" title={snap.url}>
                  {serp.url}
                </span>
              </span>
            </div>
            <span
              class="truncate pt-1 text-[19px] leading-snug text-[#1a0dab] dark:text-[#99c3ff]"
              title={snap.title}
            >
              {titleCut.text || 'No title'}
            </span>
            {serp.description ? (
              <span class="break-words text-[13.5px] leading-normal text-[#4d5156] dark:text-[#bdc1c6]">
                {descriptionCut.text}
              </span>
            ) : (
              <span class="text-[13.5px] italic text-ink-3">
                No meta description – Google shows text it picks from the page.
              </span>
            )}
          </div>
        </Card>
        <span class={cx('text-xs', cuts.length ? 'text-warn-text' : 'text-good-text')}>
          {cuts.length ? cuts.join(' ') : 'Title and description show in full in desktop results.'}
        </span>
      </Section>

      {ctx.monitored && <SearchConsole app={appView(overview)} />}

      <Section title={`Headings · ${num(outline.items.length)}`} aside={outline.summary}>
        {outline.items.length ? (
          <Card class="px-3 py-2.5">
            <ol class="flex flex-col gap-1.5">
              {outline.items.map((h, i) => (
                <li
                  key={i}
                  class={cx(
                    'flex items-baseline gap-2.5 rounded py-px pr-1',
                    h.skip ? 'bg-warn-tint text-warn-text' : h.level > 2 && 'text-ink-2',
                  )}
                  style={{ paddingLeft: `${(Math.min(h.level, 6) - 1) * 16 + 4}px` }}
                >
                  <span
                    class={cx(
                      'mono w-[22px] shrink-0 text-[11px] font-bold',
                      h.skip
                        ? 'text-warn-text'
                        : h.level === 1
                          ? 'text-accent-text'
                          : h.level === 2
                            ? 'text-ink-2'
                            : 'text-ink-3',
                    )}
                  >
                    H{h.level}
                  </span>
                  <span class={cx('min-w-0 break-words', h.level === 1 && 'font-semibold')}>
                    {h.text || <em class="text-ink-3">Empty heading</em>}
                    {h.skip > 0 && (
                      <span class="text-[11px]">
                        {' '}
                        – skips from H{h.skip} to H{h.level}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <Card class="px-4 py-3.5 text-ink-2">No headings on this page.</Card>
        )}
      </Section>

      <Section title="Meta">
        <KeyValues rows={rows} />
      </Section>
    </Page>
  );
}
