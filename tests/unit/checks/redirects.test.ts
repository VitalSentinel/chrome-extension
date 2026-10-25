import { describe, expect, it } from 'vitest';
import { redirectFindings } from '../../../src/lib/checks/redirects';
import { ids, nav } from '../fixtures';

const hop = (url: string, status: number, location: string) => ({ url, status, location });

describe('redirectFindings', () => {
  it('is silent for a direct load and a single permanent redirect', () => {
    expect(redirectFindings(nav())).toEqual([]);
    expect(
      redirectFindings(
        nav({ redirects: [hop('https://example.com/page', 301, 'https://www.example.com/page')] }),
      ),
    ).toEqual([]);
  });

  it('reports chains, temporary hops and HTTP to HTTPS upgrades', () => {
    const f = redirectFindings(
      nav({
        redirects: [
          hop('http://example.com/page', 301, 'https://example.com/page'),
          hop('https://example.com/page', 302, 'https://www.example.com/page'),
          hop('https://www.example.com/page?x', 307, 'https://www.example.com/page'),
          hop('https://www.example.com/p', 308, 'https://www.example.com/page'),
        ],
      }),
    );
    expect(f).toEqual([
      { id: 'redirect.chain', level: 'warn', params: { n: 4 } },
      {
        id: 'redirect.temporary',
        level: 'warn',
        params: { status: 302, url: 'https://example.com/page' },
      },
      {
        id: 'redirect.temporary',
        level: 'warn',
        params: { status: 307, url: 'https://www.example.com/page?x' },
      },
      { id: 'redirect.httpToHttps', level: 'info' },
    ]);
  });

  it('detects a loop back to a visited URL', () => {
    const n = nav({
      redirects: [
        hop('https://www.example.com/page', 301, '/a'),
        hop('https://www.example.com/a', 301, '/page'),
      ],
    });
    expect(ids(redirectFindings(n))).toEqual(['redirect.chain', 'redirect.loop']);
  });

  it('reports client-side redirects', () => {
    expect(ids(redirectFindings(nav({ clientRedirect: true })))).toEqual(['redirect.client']);
  });
});
