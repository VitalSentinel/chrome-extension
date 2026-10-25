import { describe, expect, it } from 'vitest';
import { cachingFindings, headerFindings, securityHeaders } from '../../../src/lib/checks/headers';
import { nav } from '../fixtures';

const SECURE: [string, string][] = [
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['Content-Security-Policy', "default-src 'self'"],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=()'],
  ['Content-Encoding', 'br'],
  ['Cache-Control', 'max-age=600'],
];

const byName = (headers: [string, string][], url = 'https://www.example.com/') =>
  Object.fromEntries(securityHeaders(nav({ url, headers })).map((h) => [h.name, [h.level, h.id]]));

describe('securityHeaders', () => {
  it('rates a hardened response as good', () => {
    const checks = securityHeaders(nav({ headers: SECURE }));
    expect(checks.every((c) => c.level === 'good' && c.id === 'hdr.ok')).toBe(true);
    expect(checks[0]?.value).toBe('max-age=31536000; includeSubDomains');
  });

  it('rates a bare response', () => {
    expect(byName([])).toEqual({
      'Strict-Transport-Security': ['warn', 'hdr.hstsMissing'],
      'Content-Security-Policy': ['warn', 'hdr.cspMissing'],
      'X-Frame-Options': ['warn', 'hdr.xfoMissing'],
      'X-Content-Type-Options': ['warn', 'hdr.nosniffMissing'],
      'Referrer-Policy': ['info', 'hdr.referrerDefault'],
      'Permissions-Policy': ['info', 'hdr.permissionsMissing'],
    });
  });

  it('flags plain HTTP and a short HSTS max-age', () => {
    expect(byName(SECURE, 'http://www.example.com/')['Strict-Transport-Security']).toEqual([
      'bad',
      'hdr.notHttps',
    ]);
    expect(
      byName([['strict-transport-security', 'max-age=300']])['Strict-Transport-Security'],
    ).toEqual(['warn', 'hdr.hstsShort']);
    expect(
      byName([['strict-transport-security', 'max-age=15552000']])['Strict-Transport-Security'],
    ).toEqual(['good', 'hdr.ok']);
  });

  it('accepts CSP frame-ancestors instead of X-Frame-Options', () => {
    expect(
      byName([['content-security-policy', "frame-ancestors 'none'"]])['X-Frame-Options'],
    ).toEqual(['good', 'hdr.xfoViaCsp']);
  });
});

describe('cachingFindings', () => {
  it('reports compression and cache headers', () => {
    expect(
      cachingFindings(
        nav({
          headers: [
            ['Content-Encoding', 'gzip'],
            ['Cache-Control', 'no-cache'],
          ],
        }),
      ),
    ).toEqual([{ id: 'hdr.compressed', level: 'good', params: { encoding: 'gzip' } }]);
    expect(cachingFindings(nav())).toEqual([
      { id: 'hdr.uncompressed', level: 'warn' },
      { id: 'hdr.noCacheControl', level: 'info' },
    ]);
  });

  it('warns about public caching with Set-Cookie and notes Vary: User-Agent', () => {
    const headers: [string, string][] = [
      ['Content-Encoding', 'br'],
      ['Cache-Control', 'public, max-age=60'],
      ['Set-Cookie', 'sid=1'],
      ['Vary', 'Accept-Encoding, User-Agent'],
    ];
    expect(cachingFindings(nav({ headers })).map((f) => f.id)).toEqual([
      'hdr.compressed',
      'hdr.publicWithCookie',
      'hdr.varyUserAgent',
    ]);
  });
});

describe('headerFindings', () => {
  it('keeps only non-good results and names the header', () => {
    expect(headerFindings(nav({ headers: SECURE }))).toEqual([]);
    const f = headerFindings(
      nav({
        headers: SECURE.filter(([k]) => k !== 'X-Content-Type-Options' && k !== 'Content-Encoding'),
      }),
    );
    expect(f).toEqual([
      { id: 'hdr.nosniffMissing', level: 'warn', params: { name: 'X-Content-Type-Options' } },
      { id: 'hdr.uncompressed', level: 'warn' },
    ]);
  });
});
