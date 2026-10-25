import type { Finding, PageSnapshot } from '../types';
import { metaValue } from './content';

export interface SocialCard {
  title: string;
  description: string;
  image: string;
  url: string;
  siteName: string;
  twitterCard: string;
}

export function socialCard(s: PageSnapshot): SocialCard {
  const m = (k: string) => metaValue(s, k) ?? '';
  return {
    title: m('og:title') || m('twitter:title') || s.title,
    description: m('og:description') || m('twitter:description') || m('description'),
    image: m('og:image') || m('og:image:url') || m('twitter:image'),
    url: m('og:url') || s.url,
    siteName: m('og:site_name'),
    twitterCard: m('twitter:card'),
  };
}

export const OG_TAGS = [
  'og:title',
  'og:description',
  'og:image',
  'og:url',
  'og:type',
  'og:site_name',
];
export const TWITTER_TAGS = [
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
  'twitter:site',
];

export function socialFindings(s: PageSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (!metaValue(s, tag)) out.push({ id: 'social.missing', level: 'warn', params: { tag } });
  }
  if (!metaValue(s, 'twitter:card'))
    out.push({ id: 'social.missing', level: 'info', params: { tag: 'twitter:card' } });
  const image = metaValue(s, 'og:image');
  if (image && !/^https?:\/\//.test(image)) out.push({ id: 'social.imageRelative', level: 'warn' });
  return out;
}
