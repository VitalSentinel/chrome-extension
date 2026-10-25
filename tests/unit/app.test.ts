import { describe, expect, it } from 'vitest';
import { accountLabel, matchDomain, ok, type Domain, unescapeHtml } from '../../src/lib/app';

describe('unescapeHtml', () => {
  it('reverses the API escaping', () => {
    expect(unescapeHtml('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt; &quot;q&quot; &#x27;a&#39;')).toBe(
      '<b>Tom & Jerry</b> "q" \'a\'',
    );
  });

  it('unescapes only one level (&amp; last)', () => {
    expect(unescapeHtml('&amp;lt;')).toBe('&lt;');
    expect(unescapeHtml('&amp;amp;')).toBe('&amp;');
  });

  it('leaves plain text alone', () => {
    expect(unescapeHtml('plain text')).toBe('plain text');
  });
});

describe('matchDomain', () => {
  const d = (domain: string): Domain => ({
    id: domain,
    workspace_id: 'w',
    domain,
    active_modules: [],
  });
  const domains = [d('acme.com'), d('shop.acme.com'), d('www.example.org'), d('Other.NET')];

  it('never matches another site on a shared host', () => {
    expect(matchDomain([d('github.io')], 'someone.github.io')).toBeNull();
    expect(matchDomain([d('example.co.uk')], 'blog.example.co.uk')?.domain).toBe('example.co.uk');
  });

  it.each([
    ['acme.com', 'acme.com'],
    ['www.acme.com', 'acme.com'],
    ['example.org', 'www.example.org'],
    ['www.example.org', 'www.example.org'],
    ['other.net', 'Other.NET'],
    ['BLOG.ACME.COM', 'acme.com'],
    ['shop.acme.com', 'shop.acme.com'],
    ['eu.shop.acme.com', 'shop.acme.com'],
  ])('%s → %s', (host, expected) => {
    expect(matchDomain(domains, host)?.domain).toBe(expected);
  });

  it('does not match a different domain sharing a suffix', () => {
    expect(matchDomain(domains, 'notacme.com')).toBeNull();
    expect(matchDomain([], 'acme.com')).toBeNull();
  });
});

describe('ok', () => {
  it('narrows to sections with status ok', () => {
    expect(ok({ status: 'ok', as_of: null })).toBe(true);
    expect(ok({ status: 'no_data', as_of: null })).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});

describe('accountLabel', () => {
  const ws = (id: string, name: string) => ({ id, name }) as never;
  const auth = (workspaces: never[], user?: string) => ({
    signedIn: true,
    workspaces,
    roles: {},
    user,
  });

  it('names the user, never a workspace', () => {
    expect(accountLabel(auth([ws('1', 'Acme')], 'Ada Lovelace'))).toEqual({
      initials: 'AL',
      title: 'Ada Lovelace',
      detail: 'VitalSentinel',
    });
  });

  it('counts several workspaces', () => {
    expect(accountLabel(auth([ws('1', 'Acme'), ws('2', 'Beta')], 'ada@example.com'))).toEqual({
      initials: 'AD',
      title: 'ada@example.com',
      detail: '2 workspaces',
    });
  });

  it('falls back to Signed in and VS without a user', () => {
    expect(accountLabel(auth([ws('1', 'Acme')]))).toEqual({
      initials: 'VS',
      title: 'Signed in',
      detail: 'VitalSentinel',
    });
  });
});
