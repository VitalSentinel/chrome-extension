import { describe, expect, it } from 'vitest';
import {
  AI_CRAWLERS,
  SEARCH_CRAWLERS,
  groupFor,
  isAllowed,
  parseRobots,
  robotsForStatus,
} from '../../../src/lib/checks/robots';

const allowed = (txt: string, agent: string, path: string) =>
  isAllowed(parseRobots(txt), agent, `https://example.com${path}`).allowed;

describe('parseRobots', () => {
  it('groups consecutive user-agent lines and collects sitemaps anywhere', () => {
    const txt = [
      'Sitemap: https://example.com/sitemap.xml',
      '# comment',
      'User-agent: Googlebot   # inline comment',
      'user-agent: BINGBOT',
      'Disallow: /private',
      'Allow: /private/ok',
      '',
      'User-agent: *',
      'Disallow:',
      'Crawl-delay: 10',
      'Disallow: /tmp',
      'sitemap: https://example.com/news.xml',
    ].join('\r\n');
    expect(parseRobots(txt)).toEqual({
      sitemaps: ['https://example.com/sitemap.xml', 'https://example.com/news.xml'],
      groups: [
        {
          agents: ['googlebot', 'bingbot'],
          rules: [
            { allow: false, path: '/private' },
            { allow: true, path: '/private/ok' },
          ],
        },
        { agents: ['*'], rules: [{ allow: false, path: '/tmp' }] },
      ],
    });
  });

  it('ignores rules before any user-agent and garbage lines', () => {
    expect(parseRobots('Disallow: /\nthis is not a record\n<html>').groups).toEqual([]);
  });

  it('starts a new group when a user-agent follows rules', () => {
    const r = parseRobots('User-agent: a\nDisallow: /a\nUser-agent: b\nDisallow: /b');
    expect(r.groups.map((g) => g.agents)).toEqual([['a'], ['b']]);
  });
});

describe('groupFor', () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /all

User-agent: Googlebot
Disallow: /g1

User-agent: googlebot-image
Disallow: /img

User-agent: Googlebot
Disallow: /g2
`);

  it('uses the most specific named group and merges groups with the same name', () => {
    expect(groupFor(robots, 'Googlebot').map((r) => r.path)).toEqual(['/g1', '/g2']);
    expect(groupFor(robots, 'Googlebot-Image/1.0').map((r) => r.path)).toEqual(['/img']);
  });

  it('falls back to the parent product group, then to *', () => {
    expect(groupFor(robots, 'Googlebot-News').map((r) => r.path)).toEqual(['/g1', '/g2']);
    expect(groupFor(robots, 'Bingbot').map((r) => r.path)).toEqual(['/all']);
  });

  it('matches agent names case-insensitively and by product token', () => {
    expect(groupFor(robots, 'GOOGLEBOT/2.1').map((r) => r.path)).toEqual(['/g1', '/g2']);
  });

  it('returns no rules when nothing applies', () => {
    expect(groupFor(parseRobots('User-agent: Bingbot\nDisallow: /'), 'Googlebot')).toEqual([]);
  });

  it('never matches a shorter name by prefix', () => {
    const txt = 'User-agent: Google\nDisallow: /g\n\nUser-agent: Applebot\nDisallow: /a';
    expect(allowed(txt, 'Googlebot', '/g')).toBe(true);
    expect(allowed(txt, 'Applebot-Extended', '/a')).toBe(true);
    expect(allowed(txt, 'Applebot', '/a')).toBe(false);
  });

  it('reads the product token of a User-agent line with a version', () => {
    expect(
      allowed(
        'User-agent: Googlebot/2.1 (+http://www.google.com/bot.html)\nDisallow: /',
        'Googlebot',
        '/x',
      ),
    ).toBe(false);
  });
});

describe('parseRobots robustness', () => {
  it('reads the first group of a file that starts with a byte order mark', () => {
    expect(allowed('﻿User-agent: *\nDisallow: /private', 'Googlebot', '/private')).toBe(false);
  });

  it('splits lines on CR alone, as old editors save them', () => {
    expect(allowed('User-agent: *\rDisallow: /a\rDisallow: /b', 'Googlebot', '/b')).toBe(false);
  });

  it('accepts the misspellings and the missing colon Google accepts', () => {
    const r = parseRobots(
      'useragent: *\ndissallow: /a\nDisallow /b\nsite-map: https://e.com/s.xml',
    );
    expect(r.groups[0].rules.map((x) => x.path)).toEqual(['/a', '/b']);
    expect(r.sitemaps).toEqual(['https://e.com/s.xml']);
  });
});

describe('robotsForStatus', () => {
  it.each([
    [200, true],
    [404, true],
    [410, true],
    [403, true],
    [429, false],
    [500, false],
    [503, false],
  ])('HTTP %i allows crawling: %s', (status, ok) => {
    const r = robotsForStatus(status, 'User-agent: *\nDisallow: /nope');
    expect(isAllowed(r, 'Googlebot', 'https://example.com/x').allowed).toBe(ok);
  });

  it('parses the body only for a 2xx', () => {
    expect(robotsForStatus(200, 'User-agent: *\nDisallow: /x').groups).toHaveLength(1);
    expect(robotsForStatus(404, 'User-agent: *\nDisallow: /x').groups).toEqual([]);
  });
});

describe('isAllowed', () => {
  it('allows everything without a matching rule', () => {
    expect(isAllowed(parseRobots(''), 'Googlebot', 'https://example.com/x')).toEqual({
      allowed: true,
      rule: null,
    });
  });

  it('the longest matching rule wins regardless of order', () => {
    const a = 'User-agent: *\nDisallow: /shop\nAllow: /shop/public';
    const b = 'User-agent: *\nAllow: /shop/public\nDisallow: /shop';
    for (const txt of [a, b]) {
      expect(allowed(txt, 'Googlebot', '/shop/public/item')).toBe(true);
      expect(allowed(txt, 'Googlebot', '/shop/cart')).toBe(false);
      expect(allowed(txt, 'Googlebot', '/shopping')).toBe(false); // prefix match
    }
    const blockDeeper = 'User-agent: *\nAllow: /shop\nDisallow: /shop/cart';
    expect(allowed(blockDeeper, 'Googlebot', '/shop/cart/1')).toBe(false);
  });

  it('Allow wins a tie of equal length', () => {
    expect(allowed('User-agent: *\nDisallow: /page\nAllow: /page', 'x', '/page')).toBe(true);
    expect(allowed('User-agent: *\nAllow: /page\nDisallow: /page', 'x', '/page')).toBe(true);
  });

  it('reports the deciding rule', () => {
    const v = isAllowed(
      parseRobots('User-agent: *\nDisallow: /a\nDisallow: /a/b'),
      'x',
      'https://example.com/a/b/c',
    );
    expect(v).toEqual({ allowed: false, rule: { allow: false, path: '/a/b' } });
  });

  it.each([
    ['Disallow: /*.pdf$', '/docs/a.pdf', false],
    ['Disallow: /*.pdf$', '/docs/a.pdf?x=1', true],
    ['Disallow: /*.pdf$', '/docs/a.PDF', true],
    ['Disallow: /*?sort=', '/list?sort=asc', false],
    ['Disallow: /*?sort=', '/list?page=2', true],
    ['Disallow: /$', '/', false],
    ['Disallow: /$', '/about', true],
    ['Disallow: /a*b*c', '/a-x-b-y-c-z', false],
    ['Disallow: /a+b', '/a+b', false],
    ['Disallow: /a+b', '/aab', true],
    ['Disallow: /(x).', '/(x).html', false],
    ['Disallow: /Admin', '/admin', true],
    ['Disallow: /', '/anything', false],
  ])('%s on %s → allowed %s', (rule, path, ok) => {
    expect(allowed(`User-agent: *\n${rule}`, 'Googlebot', path)).toBe(ok);
  });

  it('a longer wildcard Allow beats a shorter Disallow', () => {
    const txt = 'User-agent: *\nDisallow: /*.php\nAllow: /public/*.php';
    expect(allowed(txt, 'x', '/public/index.php')).toBe(true);
    expect(allowed(txt, 'x', '/admin/index.php')).toBe(false);
  });

  it('matches percent-encoded and unencoded paths alike', () => {
    expect(allowed('User-agent: *\nDisallow: /café', 'x', '/caf%C3%A9/menu')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /caf%C3%A9', 'x', '/café/menu')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /100%', 'x', '/100%')).toBe(false); // malformed escape kept as-is
  });

  it('a specific group overrides *, even when it allows everything', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow:';
    expect(allowed(txt, 'Googlebot', '/x')).toBe(true);
    expect(allowed(txt, 'Bingbot', '/x')).toBe(false);
  });

  it('blocks AI crawlers named in their own group only', () => {
    const txt = 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /';
    const blocked = AI_CRAWLERS.filter((bot) => !allowed(txt, bot, '/'));
    expect(blocked).toEqual(['GPTBot', 'CCBot']);
    expect(SEARCH_CRAWLERS.every((bot) => allowed(txt, bot, '/'))).toBe(true);
  });

  // Google's parser (and RFC 9309) only ends a run of user-agent lines at a rule line; other
  // records such as Sitemap or Crawl-delay between two user-agent lines do not split the group.
  it('keeps user-agent lines separated by a non-rule record in one group', () => {
    expect(allowed('User-agent: a\nCrawl-delay: 5\nUser-agent: b\nDisallow: /', 'a', '/x')).toBe(
      false,
    );
  });
});
