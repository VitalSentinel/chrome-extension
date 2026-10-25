import { describe, expect, it } from 'vitest';
import {
  isPublicHost,
  isWebUrl,
  normalizeUrl,
  originOf,
  sameSite,
  siteOf,
  stripWww,
  sameHost,
  withoutTracking,
} from '../../src/lib/url';

describe('stripWww', () => {
  it('lower-cases and drops a leading www.', () => {
    expect(stripWww('WWW.Example.COM')).toBe('example.com');
    expect(stripWww('www2.example.com')).toBe('www2.example.com');
  });
});

describe('siteOf', () => {
  it.each([
    ['example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['shop.acme.com', 'acme.com'],
    ['a.b.c.acme.io', 'acme.io'],
    ['www.bbc.co.uk', 'bbc.co.uk'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['shop.example.com.au', 'example.com.au'],
    ['docs.someone.github.io', 'someone.github.io'],
    ['shop.myshopify.com', 'shop.myshopify.com'],
    ['news.example.de', 'example.de'],
    ['localhost', 'localhost'],
  ])('%s → %s', (host, site) => {
    expect(siteOf(host)).toBe(site);
  });
});

describe('isWebUrl', () => {
  it.each([
    ['https://example.com', true],
    ['HTTP://example.com/x', true],
    ['chrome://extensions', false],
    ['file:///tmp/a.html', false],
    ['ftp://example.com', false],
    ['', false],
    [undefined, false],
  ])('%s → %s', (url, expected) => {
    expect(isWebUrl(url)).toBe(expected);
  });
});

describe('isPublicHost', () => {
  it.each([
    ['example.com', true],
    ['shop.testing.com', true],
    ['localhost', false],
    ['app.localhost', false],
    ['intranet', false],
    ['192.168.0.1', false],
    ['[::ffff:1.2.3.4]', false],
    ['printer.local', false],
    ['api.internal', false],
    ['site.test', false],
    ['nas.lan', false],
    ['jira.corp', false],
    ['router.home.arpa', false],
    ['wiki.intranet', false],
    ['www.example', false],
    ['foo.invalid', false],
  ])('%s → %s', (host, expected) => {
    expect(isPublicHost(host)).toBe(expected);
  });
});

describe('sameSite', () => {
  it('treats subdomains of one registrable domain as the same site', () => {
    expect(sameSite('https://blog.example.com/x', 'http://www.example.com/')).toBe(true);
    expect(sameSite('https://example.co.uk', 'https://shop.example.co.uk')).toBe(true);
  });

  it('separates different sites, including different co.uk owners', () => {
    expect(sameSite('https://a.com', 'https://b.com')).toBe(false);
    expect(sameSite('https://a.co.uk', 'https://b.co.uk')).toBe(false);
  });

  it('is false for unparsable URLs', () => {
    expect(sameSite('not a url', 'https://a.com')).toBe(false);
  });
});

describe('originOf / normalizeUrl', () => {
  it('returns scheme, host and port', () => {
    expect(originOf('https://a.com:8080/x?y=1#z')).toBe('https://a.com:8080');
  });

  it('drops the fragment and canonicalises the URL', () => {
    expect(normalizeUrl('https://A.com/x?q=1#frag')).toBe('https://a.com/x?q=1');
    expect(normalizeUrl('https://a.com')).toBe('https://a.com/');
  });

  it('returns invalid input unchanged', () => {
    expect(normalizeUrl('/relative')).toBe('/relative');
  });
});

describe('sameHost', () => {
  it('matches the exact host only', () => {
    expect(sameHost('https://a.example.com/x', 'http://a.example.com/')).toBe(true);
    expect(sameHost('https://b.example.com/', 'https://a.example.com/')).toBe(false);
    expect(sameHost('not a url', 'https://a.example.com/')).toBe(false);
  });
});

describe('withoutTracking', () => {
  it('drops the hash and campaign and click parameters, keeping the rest in order', () => {
    expect(
      withoutTracking(
        'https://www.example.com/a?utm_source=x&id=7&UTM_Medium=y&gclid=1&sort=new&fbclid=2&hsa_cam=3#top',
      ),
    ).toBe('https://www.example.com/a?id=7&sort=new');
  });

  it('keeps the other parameters exactly as written', () => {
    expect(withoutTracking('https://example.com/s?q=a%20b&flag&utm_source=x')).toBe(
      'https://example.com/s?q=a%20b&flag',
    );
    expect(withoutTracking('https://example.com/s?q=a%20b&flag')).toBe(
      'https://example.com/s?q=a%20b&flag',
    );
    expect(withoutTracking('https://example.com/s?utm%5Fsource=x&a+b=1')).toBe(
      'https://example.com/s?a+b=1',
    );
  });

  it('keeps ref, which many sites use as a real parameter', () => {
    expect(withoutTracking('https://example.com/docs?ref=main&utm_medium=x')).toBe(
      'https://example.com/docs?ref=main',
    );
  });

  it('removes the question mark when nothing is left', () => {
    expect(withoutTracking('https://www.example.com/?utm_source=extension&utm_medium=popup')).toBe(
      'https://www.example.com/',
    );
    expect(withoutTracking('https://www.example.com/page')).toBe('https://www.example.com/page');
  });

  it('returns what it cannot parse unchanged', () => {
    expect(withoutTracking('not a url')).toBe('not a url');
  });
});
