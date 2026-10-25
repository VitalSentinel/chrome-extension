import { describe, expect, it } from 'vitest';
import {
  exportRules,
  isValidPattern,
  patternFor,
  patternLabel,
  upsertRule,
  type JsRule,
} from '../../src/lib/jsRules';
import { siteOf } from '../../src/lib/url';

describe('patternFor / patternLabel', () => {
  it('builds host and domain patterns', () => {
    expect(patternFor('https://shop.acme.com/x?y', 'host', siteOf)).toBe('*://shop.acme.com/*');
    expect(patternFor('https://shop.acme.com/x', 'domain', siteOf)).toBe('*://[*.]acme.com/*');
    expect(patternFor('http://www.bbc.co.uk/news', 'domain', siteOf)).toBe('*://[*.]bbc.co.uk/*');
  });

  it('keeps an IP address to itself even for the domain scope', () => {
    expect(patternFor('http://192.168.1.20/x', 'domain', siteOf)).toBe('*://192.168.1.20/*');
  });

  it('uses a single pattern for local files', () => {
    expect(patternFor('file:///Users/me/a.html', 'host', siteOf)).toBe('file:///*');
  });

  it('labels patterns without scheme and path wildcard', () => {
    expect(patternLabel('*://[*.]acme.com/*')).toBe('[*.]acme.com');
    expect(patternLabel('https://shop.acme.com/*')).toBe('shop.acme.com');
  });
});

describe('upsertRule', () => {
  it('puts the new rule first and replaces one with the same pattern', () => {
    const rules: JsRule[] = [
      { pattern: '*://a.com/*', setting: 'block', addedAt: 1 },
      { pattern: '*://b.com/*', setting: 'block', addedAt: 2 },
    ];
    const next = upsertRule(rules, { pattern: '*://b.com/*', setting: 'allow', addedAt: 3 });
    expect(next).toEqual([
      { pattern: '*://b.com/*', setting: 'allow', addedAt: 3 },
      { pattern: '*://a.com/*', setting: 'block', addedAt: 1 },
    ]);
    expect(rules).toHaveLength(2); // input untouched
  });
});

describe('isValidPattern', () => {
  it.each([
    ['<all_urls>', true],
    ['*://example.com/*', true],
    ['*://[*.]example.com/*', true],
    ['https://example.com/path', true],
    ['http://localhost:3000/*', true],
    ['file:///*', true],
    ['example.com', false],
    ['ftp://example.com/*', false],
    ['*://example.com', false],
    ['*://exa mple.com/*', false],
  ])('%s → %s', (p, ok) => {
    expect(isValidPattern(p)).toBe(ok);
  });
});

describe('exportRules', () => {
  it('writes the rules as indented JSON', () => {
    const rules: JsRule[] = [{ pattern: '*://a.com/*', setting: 'block', addedAt: 5 }];
    expect(JSON.parse(exportRules(rules))).toEqual(rules);
    expect(exportRules(rules)).toContain('\n  ');
  });
});
