import { describe, expect, it } from 'vitest';
import { socialCard, socialFindings } from '../../../src/lib/checks/social';
import { meta, snap } from '../fixtures';

describe('socialCard', () => {
  it('prefers Open Graph tags', () => {
    const s = snap({
      title: 'Page',
      meta: meta({
        'og:title': 'OG',
        'twitter:title': 'TW',
        'og:description': 'OG desc',
        'og:image': 'https://a.com/og.jpg',
        'og:url': 'https://a.com/canonical',
        'og:site_name': 'Acme',
        'twitter:card': 'summary_large_image',
      }),
    });
    expect(socialCard(s)).toEqual({
      title: 'OG',
      description: 'OG desc',
      image: 'https://a.com/og.jpg',
      url: 'https://a.com/canonical',
      siteName: 'Acme',
      twitterCard: 'summary_large_image',
    });
  });

  it('falls back to Twitter tags, then the page itself', () => {
    const tw = snap({
      title: 'Page',
      meta: meta({
        'twitter:title': 'TW',
        'twitter:description': 'TW desc',
        'twitter:image': 'tw.jpg',
      }),
    });
    expect(socialCard(tw)).toMatchObject({
      title: 'TW',
      description: 'TW desc',
      image: 'tw.jpg',
      url: tw.url,
      siteName: '',
    });
    const bare = snap({
      title: 'Page',
      meta: meta({ description: 'Meta desc', 'og:image:url': 'img.jpg' }),
    });
    expect(socialCard(bare)).toMatchObject({
      title: 'Page',
      description: 'Meta desc',
      image: 'img.jpg',
    });
  });
});

describe('socialFindings', () => {
  it('lists missing tags', () => {
    expect(socialFindings(snap())).toEqual([
      { id: 'social.missing', level: 'warn', params: { tag: 'og:title' } },
      { id: 'social.missing', level: 'warn', params: { tag: 'og:description' } },
      { id: 'social.missing', level: 'warn', params: { tag: 'og:image' } },
      { id: 'social.missing', level: 'warn', params: { tag: 'og:url' } },
      { id: 'social.missing', level: 'info', params: { tag: 'twitter:card' } },
    ]);
  });

  it('wants an absolute og:image', () => {
    const tags = {
      'og:title': 't',
      'og:description': 'd',
      'og:url': 'u',
      'twitter:card': 'summary',
    };
    expect(socialFindings(snap({ meta: meta({ ...tags, 'og:image': '/og.jpg' }) }))).toEqual([
      { id: 'social.imageRelative', level: 'warn' },
    ]);
    expect(
      socialFindings(snap({ meta: meta({ ...tags, 'og:image': 'https://a.com/og.jpg' }) })),
    ).toEqual([]);
  });
});
