import type { Finding, NavRecord } from '../types';

export function redirectFindings(nav: NavRecord): Finding[] {
  const out: Finding[] = [];
  const hops = nav.redirects;
  if (hops.length > 1)
    out.push({ id: 'redirect.chain', level: 'warn', params: { n: hops.length } });
  for (const hop of hops) {
    if (hop.status === 302 || hop.status === 307) {
      out.push({
        id: 'redirect.temporary',
        level: 'warn',
        params: { status: hop.status, url: hop.url },
      });
    }
  }
  const urls = [...hops.map((h) => h.url), nav.url];
  if (new Set(urls).size < urls.length) out.push({ id: 'redirect.loop', level: 'bad' });
  if (hops.some((h) => h.url.startsWith('http:')) && nav.url.startsWith('https:')) {
    out.push({ id: 'redirect.httpToHttps', level: 'info' });
  }
  if (nav.clientRedirect) out.push({ id: 'redirect.client', level: 'warn' });
  return out;
}
