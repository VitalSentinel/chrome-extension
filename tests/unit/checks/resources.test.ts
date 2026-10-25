import { describe, expect, it } from 'vitest';
import { auditResources } from '../../../src/lib/checks/resources';
import { resource } from '../fixtures';

const PAGE = 'https://www.example.com/page';

describe('auditResources', () => {
  it('finds render-blocking and uncompressed text resources', () => {
    const r = auditResources(
      [
        resource('https://www.example.com/app.js?v=3', {
          renderBlocking: true,
          encodedSize: 5000,
          decodedSize: 5000,
          transferSize: 5300,
        }),
        resource('https://www.example.com/a.css', {
          encodedSize: 2000,
          decodedSize: 9000,
          transferSize: 2300,
        }),
        resource('https://www.example.com/small.css', { encodedSize: 500, decodedSize: 500 }),
        resource('https://www.example.com/photo.jpg', {
          type: 'img',
          encodedSize: 90_000,
          decodedSize: 90_000,
        }),
        resource('https://cdn.other.com/lib.js', { encodedSize: 0, decodedSize: 0 }),
      ],
      PAGE,
    );
    expect(r.renderBlocking.map((x) => x.url)).toEqual(['https://www.example.com/app.js?v=3']);
    expect(r.uncompressed.map((x) => x.url)).toEqual(['https://www.example.com/app.js?v=3']);
    expect(r.findings.map((f) => f.id)).toEqual(['res.renderBlocking', 'res.uncompressed']);
  });

  it('groups third-party bytes by host, counting subdomains as first party', () => {
    const r = auditResources(
      [
        resource('https://www.example.com/app.js', { transferSize: 10_000 }),
        resource('https://static.example.com/a.css', { transferSize: 0, encodedSize: 5_000 }),
        resource('https://www.googletagmanager.com/gtm.js', { transferSize: 30_000 }),
        resource('https://connect.facebook.net/fbevents.js', { transferSize: 8_000 }),
        resource('https://www.googletagmanager.com/gtag/js', { transferSize: 7_000 }),
      ],
      PAGE,
    );
    expect(r.totalBytes).toBe(60_000);
    expect(r.thirdPartyBytes).toBe(45_000);
    expect(r.thirdParty).toEqual([
      { host: 'www.googletagmanager.com', bytes: 37_000, count: 2 },
      { host: 'connect.facebook.net', bytes: 8_000, count: 1 },
    ]);
    expect(r.findings).toEqual([
      { id: 'res.thirdPartyHeavy', level: 'warn', params: { share: 75 } },
    ]);
  });

  it('is empty for no resources', () => {
    expect(auditResources([], PAGE)).toEqual({
      renderBlocking: [],
      uncompressed: [],
      thirdParty: [],
      totalBytes: 0,
      thirdPartyBytes: 0,
      findings: [],
    });
  });
});
