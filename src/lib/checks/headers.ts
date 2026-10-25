import type { Finding, NavRecord } from '../types';
import { header } from './indexability';

export interface HeaderCheck {
  name: string;
  value: string | null;
  level: 'good' | 'warn' | 'bad' | 'info';
  id: string;
}

const first = (nav: NavRecord, name: string) => header(nav, name)[0] ?? null;

export function securityHeaders(nav: NavRecord): HeaderCheck[] {
  const https = nav.url.startsWith('https:');
  const hsts = first(nav, 'strict-transport-security');
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? '')?.[1] ?? 0);
  const csp = first(nav, 'content-security-policy');
  const xfo = first(nav, 'x-frame-options');
  const frameAncestors = /frame-ancestors/i.test(csp ?? '');
  return [
    {
      name: 'Strict-Transport-Security',
      value: hsts,
      level: !https ? 'bad' : !hsts ? 'warn' : maxAge < 15552000 ? 'warn' : 'good',
      id: !https
        ? 'hdr.notHttps'
        : !hsts
          ? 'hdr.hstsMissing'
          : maxAge < 15552000
            ? 'hdr.hstsShort'
            : 'hdr.ok',
    },
    {
      name: 'Content-Security-Policy',
      value: csp,
      level: csp ? 'good' : 'warn',
      id: csp ? 'hdr.ok' : 'hdr.cspMissing',
    },
    {
      name: 'X-Frame-Options',
      value: xfo,
      level: xfo || frameAncestors ? 'good' : 'warn',
      id: xfo ? 'hdr.ok' : frameAncestors ? 'hdr.xfoViaCsp' : 'hdr.xfoMissing',
    },
    {
      name: 'X-Content-Type-Options',
      value: first(nav, 'x-content-type-options'),
      level: /nosniff/i.test(first(nav, 'x-content-type-options') ?? '') ? 'good' : 'warn',
      id: /nosniff/i.test(first(nav, 'x-content-type-options') ?? '')
        ? 'hdr.ok'
        : 'hdr.nosniffMissing',
    },
    {
      name: 'Referrer-Policy',
      value: first(nav, 'referrer-policy'),
      level: first(nav, 'referrer-policy') ? 'good' : 'info',
      id: first(nav, 'referrer-policy') ? 'hdr.ok' : 'hdr.referrerDefault',
    },
    {
      name: 'Permissions-Policy',
      value: first(nav, 'permissions-policy'),
      level: first(nav, 'permissions-policy') ? 'good' : 'info',
      id: first(nav, 'permissions-policy') ? 'hdr.ok' : 'hdr.permissionsMissing',
    },
  ];
}

export function cachingFindings(nav: NavRecord): Finding[] {
  const out: Finding[] = [];
  const cc = first(nav, 'cache-control') ?? '';
  const encoding = first(nav, 'content-encoding') ?? '';
  if (!encoding) out.push({ id: 'hdr.uncompressed', level: 'warn' });
  else out.push({ id: 'hdr.compressed', level: 'good', params: { encoding } });
  if (!cc) out.push({ id: 'hdr.noCacheControl', level: 'info' });
  if (header(nav, 'set-cookie').length && /public/i.test(cc))
    out.push({ id: 'hdr.publicWithCookie', level: 'warn' });
  const vary = first(nav, 'vary');
  if (vary && /user-agent/i.test(vary)) out.push({ id: 'hdr.varyUserAgent', level: 'info' });
  return out;
}

export function headerFindings(nav: NavRecord): Finding[] {
  return [
    ...securityHeaders(nav)
      .filter((h) => h.level !== 'good')
      .map((h) => ({ id: h.id, level: h.level, params: { name: h.name } })),
    ...cachingFindings(nav).filter((f) => f.level !== 'good'),
  ];
}
