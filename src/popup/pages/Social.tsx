import { useMemo, useState } from 'preact/hooks';
import { metaValue } from '../../lib/checks/content';
import { OG_TAGS, socialCard, socialFindings, TWITTER_TAGS } from '../../lib/checks/social';
import type { Level, PageSnapshot } from '../../lib/types';
import { Card, cx, Findings, LEVEL_TEXT, Mark, Page, Section } from '../../ui/kit';
import type { PageProps } from '../types';
import { sameHost } from '../../lib/url';

const REQUIRED = new Set(['og:title', 'og:description', 'og:image', 'og:url']);
const FALLBACK: Record<string, string> = {
  'twitter:title': 'og:title',
  'twitter:description': 'og:description',
  'twitter:image': 'og:image',
};

interface TagRow {
  tag: string;
  value: string | null;
  note: string;
  level: Level;
}

function tagRows(snap: PageSnapshot, prefix: string, listed: string[]): TagRow[] {
  const known = listed.map((tag): TagRow => {
    const value = metaValue(snap, tag);
    if (value) return { tag, value, note: '', level: 'good' };
    const fallback = FALLBACK[tag];
    if (fallback && metaValue(snap, fallback))
      return { tag, value, note: `Falls back to ${fallback}`, level: 'info' };
    return {
      tag,
      value,
      note: REQUIRED.has(tag) ? 'Missing' : 'Not set',
      level: REQUIRED.has(tag) ? 'warn' : 'info',
    };
  });
  const others = snap.meta.filter((m) => m.key.startsWith(prefix) && !listed.includes(m.key));
  return [
    ...known,
    ...others.map((m): TagRow => ({ tag: m.key, value: m.content, note: '', level: 'good' })),
  ];
}

function Tag({ row }: { row: TagRow }) {
  return (
    <div
      class={cx(
        'grid grid-cols-[16px_150px_minmax(0,1fr)] items-baseline gap-2.5 px-4 py-2',
        row.level === 'warn' && 'bg-warn-tint',
      )}
    >
      {row.level === 'info' ? (
        <span class="w-4 text-center font-bold text-ink-3" aria-hidden="true">
          –
        </span>
      ) : (
        <Mark level={row.level} />
      )}
      <span class="mono break-words">{row.tag}</span>
      {row.value === null ? (
        <span class={row.level === 'warn' ? LEVEL_TEXT.warn : 'text-ink-2'}>{row.note}</span>
      ) : (
        <span
          class={cx(
            'min-w-0 break-words',
            /^https?:\/\//.test(row.value) && 'mono break-all text-ink-2',
          )}
        >
          {row.value}
        </span>
      )}
    </div>
  );
}

const absolute = (url: string, base: string) => {
  try {
    return url ? new URL(url, base).href : '';
  } catch {
    return '';
  }
};

/** The share image, or a placeholder when there is none or it fails to load. */
function ShareImage({ src, empty, class: c }: { src: string; empty: string; class?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class={cx('relative overflow-hidden bg-hover', c)}>
      {src && !broken ? (
        <img
          src={src}
          alt=""
          referrerpolicy="no-referrer"
          class="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span class="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-ink-3">
          {src ? 'The image could not be loaded' : empty}
        </span>
      )}
    </div>
  );
}

export default function Social({ snap, settings }: PageProps) {
  const card = useMemo(() => socialCard(snap), [snap]);
  const findings = useMemo(() => socialFindings(snap), [snap]);
  const tags = useMemo(
    () => [...tagRows(snap, 'og:', OG_TAGS), ...tagRows(snap, 'twitter:', TWITTER_TAGS)],
    [snap],
  );
  const resolved = absolute(card.image, snap.url);
  // Offline mode: no request to another host, so no preview image from a CDN.
  const blocked = settings.offline && !!resolved && !sameHost(resolved, snap.url);
  const image = blocked ? '' : resolved;
  const empty = blocked ? 'Not loaded in offline mode' : 'No og:image';
  const host = useMemo(
    () => new URL(absolute(card.url, snap.url) || snap.url).hostname.replace(/^www\./, ''),
    [card, snap],
  );
  const title = card.title || 'No title';
  const large = card.twitterCard === 'summary_large_image';

  return (
    <Page title="Social tags">
      <Findings items={findings} />

      <Section title="Previews">
        <div class="grid grid-cols-2 items-start gap-x-3.5 gap-y-1.5">
          <span class="text-xs font-semibold text-ink-2">Facebook / LinkedIn</span>
          <span class="text-xs font-semibold text-ink-2">
            X{card.twitterCard && ` · ${card.twitterCard}`}
          </span>
          <Card class="overflow-hidden">
            <ShareImage src={image} empty={empty} class="aspect-[1.91/1]" key={image} />
            <div class="flex flex-col gap-0.5 border-t border-hairline bg-surface-inset px-3 py-2.5">
              <span class="truncate text-[11px] uppercase tracking-wide text-ink-2">{host}</span>
              <span class="line-clamp-2 break-words font-bold">{title}</span>
              {card.description && (
                <span class="line-clamp-2 break-words text-xs text-ink-2">{card.description}</span>
              )}
            </div>
          </Card>
          <div class="flex min-w-0 flex-col gap-1.5">
            {large ? (
              <Card class="overflow-hidden">
                <div class="relative">
                  <ShareImage src={image} empty={empty} class="aspect-[1.91/1]" key={image} />
                  <span class="absolute bottom-2 left-2 max-w-[85%] truncate rounded bg-pop/80 px-1.5 py-0.5 text-[11px] text-pop-on">
                    {title}
                  </span>
                </div>
              </Card>
            ) : (
              <Card class="flex overflow-hidden">
                <ShareImage
                  src={image}
                  empty=""
                  class="aspect-square w-[88px] shrink-0 border-r border-hairline"
                  key={image}
                />
                <div class="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
                  <span class="truncate text-[11px] text-ink-2">{host}</span>
                  <span class="line-clamp-2 break-words text-xs font-semibold">{title}</span>
                  {card.description && (
                    <span class="line-clamp-2 break-words text-[11px] text-ink-2">
                      {card.description}
                    </span>
                  )}
                </div>
              </Card>
            )}
            <span class="truncate text-xs text-ink-2">From {host}</span>
          </div>
        </div>
      </Section>

      <Section title={`Tags · ${tags.filter((r) => r.value !== null).length}`}>
        <Card class="divide-y divide-hairline overflow-hidden text-[12.5px]">
          {tags.map((r) => (
            <Tag row={r} key={r.tag} />
          ))}
        </Card>
      </Section>
    </Page>
  );
}
