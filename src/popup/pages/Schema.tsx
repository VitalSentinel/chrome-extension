import { useMemo, useState } from 'preact/hooks';
import { analyseSchema, type JsonObject, type SchemaItem } from '../../lib/checks/schema';
import type { Level } from '../../lib/types';
import { track } from '../data';
import {
  Button,
  Card,
  Chip,
  cx,
  ErrorNote,
  Findings,
  LEVEL_TEXT,
  LinkButton,
  Mark,
  Page,
  Pill,
  Section,
} from '../../ui/kit';
import type { PageProps } from '../types';

const pretty = (src: string) => {
  try {
    return JSON.stringify(JSON.parse(src), null, 2);
  } catch {
    return src.trim();
  }
};

function eligibility(item: SchemaItem): [Level, string] {
  if (item.eligible === null) return ['info', 'No rich result type'];
  if (!item.eligible) return ['bad', 'Not eligible'];
  const n = item.props.filter((p) => p.level === 'warn').length;
  return n ? ['warn', `Eligible · ${n} ${n === 1 ? 'warning' : 'warnings'}`] : ['good', 'Eligible'];
}

const MISSING = { bad: 'Required, missing', warn: 'Recommended, missing' } as const;

/** A JSON-LD value in one line: scalars as they are, objects by their name, id or type. */
function summary(v: unknown): string {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v))
    return v.length ? `${summary(v[0])}${v.length > 1 ? ` (+${v.length - 1})` : ''}` : '';
  const o = v as JsonObject;
  return summary(o.name ?? o['@id'] ?? o.url ?? o['@type'] ?? JSON.stringify(o).slice(0, 80));
}

/** BreadcrumbList as the trail Google shows: Home › Blog › Post. */
function trail(data: JsonObject): string {
  const list = data.itemListElement;
  if (!Array.isArray(list)) return '';
  return (list as JsonObject[])
    .filter((el) => el && typeof el === 'object')
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((el) => summary(el.name ?? el.item))
    .filter(Boolean)
    .join(' › ');
}

const isUrl = (v: string) => /^https?:\/\//.test(v);

function PropRow({ name, value, level }: { name: string; value: string; level: Level }) {
  return (
    <div
      class={cx(
        'grid grid-cols-[16px_150px_minmax(0,1fr)] items-baseline gap-2.5 px-4 py-2',
        level === 'bad' && 'bg-poor-tint',
        level === 'warn' && 'bg-warn-tint',
      )}
    >
      <Mark level={level} />
      <span class="mono break-words">{name}</span>
      {level !== 'good' ? (
        <span class={LEVEL_TEXT[level]}>{MISSING[level as 'bad' | 'warn']}</span>
      ) : !value ? (
        <span class="text-ink-3">Empty</span>
      ) : (
        <span class={cx('min-w-0 break-words', isUrl(value) && 'mono break-all text-ink-2')}>
          {value}
        </span>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: SchemaItem }) {
  const [level, label] = eligibility(item);
  const crumbs = item.type === 'BreadcrumbList' && item.eligible ? trail(item.data) : '';
  const props = item.props.length
    ? item.props
    : Object.entries(item.data)
        .filter(([k]) => !k.startsWith('@'))
        .map(([name, v]) => ({ name, value: summary(v), level: 'good' as const }));
  return (
    <Card class="overflow-hidden">
      <div class="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
        <span class="min-w-0 flex-grow break-words text-[14px] font-bold">{item.type}</span>
        <Pill level={level}>{label}</Pill>
      </div>
      {crumbs ? (
        <p class="break-words px-4 py-2.5 text-[12.5px] text-ink-2">{crumbs}</p>
      ) : props.length ? (
        <div class="divide-y divide-hairline text-[12.5px]">
          {props.map((p) => (
            <PropRow {...p} key={p.name} />
          ))}
        </div>
      ) : (
        <p class="px-4 py-2.5 text-ink-2">No properties.</p>
      )}
    </Card>
  );
}

export default function Schema({ snap }: PageProps) {
  const { items, errors, findings } = useMemo(() => analyseSchema(snap.jsonLd), [snap]);
  const json = useMemo(() => snap.jsonLd.map(pretty).join('\n\n'), [snap]);
  const microdata = useMemo(() => [...new Set(snap.microdataTypes)], [snap]);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = () =>
    navigator.clipboard.writeText(json).then(
      () => {
        track('copy.schema');
        setCopied('Copied');
      },
      () => setCopied('Copy failed'),
    );

  const url = encodeURIComponent(snap.url);
  return (
    <Page
      title="Structured data"
      aside={
        <span class="text-[15px] text-ink-3">
          {items.length} {items.length === 1 ? 'item' : 'items'} · JSON-LD
        </span>
      }
    >
      <div class="flex flex-wrap gap-2.5">
        <LinkButton href={`https://search.google.com/test/rich-results?url=${url}`}>
          Rich Results Test ↗
        </LinkButton>
        <LinkButton href={`https://validator.schema.org/#url=${url}`}>
          Schema.org validator ↗
        </LinkButton>
        <span class="flex-grow" />
        <Button onClick={copy} disabled={!json}>
          {copied ?? 'Copy JSON-LD'}
        </Button>
      </div>

      <Findings items={findings} />

      {errors.length > 0 && (
        <ErrorNote>
          <span class="font-semibold">JSON-LD that could not be parsed</span>
          <ul class="mt-1 flex flex-col gap-0.5">
            {errors.map((e, i) => (
              <li class="mono break-words" key={i}>
                {e}
              </li>
            ))}
          </ul>
        </ErrorNote>
      )}

      {items.length > 0 && (
        <div class="flex flex-col gap-3.5">
          {items.map((item, i) => (
            <ItemCard item={item} key={i} />
          ))}
        </div>
      )}

      {microdata.length > 0 && (
        <Section title={`Microdata · ${microdata.length}`}>
          <div class="flex flex-wrap gap-1.5">
            {microdata.map((t) => (
              <Chip mono key={t}>
                {t}
              </Chip>
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
