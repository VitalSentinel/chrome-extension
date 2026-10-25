import { describe, expect, it } from 'vitest';
import {
  detectTech,
  FINGERPRINTS,
  PROBE_GLOBALS,
  type TechInput,
} from '../../../src/lib/checks/tech';
import { meta, resource } from '../fixtures';

const input = (o: {
  generator?: string;
  scripts?: string[];
  stylesheets?: string[];
  resources?: string[];
  headers?: [string, string][];
  cookies?: string[];
  globals?: string[];
}): TechInput => ({
  snapshot: {
    meta: o.generator ? meta({ generator: o.generator }) : [],
    scripts: o.scripts ?? [],
    stylesheets: o.stylesheets ?? [],
    resources: (o.resources ?? []).map((u) => resource(u)),
  },
  nav: o.headers ? { headers: o.headers } : null,
  cookies: o.cookies ?? [],
  globals: o.globals ?? [],
});

const found = (i: TechInput) =>
  detectTech(i).map((t) => `${t.name}${t.version ? ` ${t.version}` : ''}`);

describe('detectTech', () => {
  it('detects nothing on an empty page', () => {
    expect(detectTech(input({}))).toEqual([]);
  });

  it('reads a WordPress site from generator, plugin URLs and server headers', () => {
    const tech = detectTech(
      input({
        generator: 'WordPress 6.6.2',
        scripts: ['https://www.example.com/wp-content/plugins/wordpress-seo/js/a.js?ver=23.1'],
        stylesheets: ['https://fonts.googleapis.com/css2?family=Inter'],
        headers: [
          ['Server', 'nginx/1.25.3'],
          ['X-Powered-By', 'PHP/8.2.10'],
        ],
      }),
    );
    expect(tech).toEqual([
      { name: 'WordPress', category: 'cms', version: '6.6.2' },
      { name: 'Yoast SEO', category: 'cms', version: '' },
      { name: 'nginx', category: 'server', version: '1.25.3' },
      { name: 'PHP', category: 'server', version: '8.2.10' },
      { name: 'Google Fonts', category: 'fonts', version: '' },
    ]);
  });

  it('takes the WordPress version from ?ver= when there is no generator', () => {
    expect(
      found(input({ scripts: ['https://a.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1'] })),
    ).toContain('WordPress 3.7.1');
  });

  it('reads tag IDs as versions for Google tags', () => {
    const tech = found(
      input({
        scripts: [
          'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123',
          'https://www.googletagmanager.com/gtag/js?id=G-XYZ789',
        ],
        resources: ['https://www.googletagmanager.com/gtag/js?id=AW-123456'],
      }),
    );
    expect(tech).toEqual([
      'Google Tag Manager GTM-ABC123',
      'Google Analytics 4 G-XYZ789',
      'Google Ads',
    ]);
  });

  it('uses headers, cookies and page globals', () => {
    const tech = found(
      input({
        headers: [
          ['x-shopid', '123'],
          ['server', 'cloudflare'],
          ['x-vercel-id', 'fra1::abc'],
        ],
        cookies: ['_hjSession_123', '_fbp', 'OptanonConsent'],
        globals: ['__NEXT_DATA__', 'jQuery'],
      }),
    );
    expect(tech).toEqual([
      'Shopify',
      'Next.js',
      'jQuery',
      'Cloudflare',
      'Vercel',
      'Meta Pixel',
      'Hotjar',
      'OneTrust',
    ]);
  });

  it('does not treat a cookie prefix as a match for an exact-name fingerprint', () => {
    expect(found(input({ cookies: ['_fbp_extra', 'CookieConsentX'] }))).toEqual([]);
  });

  // Regression: /jquery[.-]([\d.]+)/ also swallows the dot before the extension ("min" or "js"), so
  // jquery-3.7.1.min.js and jquery-3.7.1.js both report "3.7.1.".
  it.each([
    'https://code.jquery.com/jquery-3.7.1.min.js',
    'https://code.jquery.com/jquery-3.7.1.js',
  ])('reads a clean jQuery version from %s', (src) => {
    expect(found(input({ scripts: [src] }))).toEqual(['jQuery 3.7.1']);
  });
});

describe('fingerprint data', () => {
  it('has unique names and lists every global once for the probe', () => {
    expect(new Set(FINGERPRINTS.map((f) => f.name)).size).toBe(FINGERPRINTS.length);
    expect(PROBE_GLOBALS).toEqual(
      expect.arrayContaining(['Shopify', '__NEXT_DATA__', '__NUXT__', 'jQuery', 'ng']),
    );
    expect(new Set(PROBE_GLOBALS).size).toBe(PROBE_GLOBALS.length);
  });
});
