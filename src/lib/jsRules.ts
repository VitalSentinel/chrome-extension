// JavaScript allow/block rules as chrome.contentSettings
// patterns. Rules are mirrored in chrome.storage so the options page can list, export and
// re-apply them; Chrome itself has no "list rules" API.

export type JsSetting = 'allow' | 'block';
export type RuleScope = 'host' | 'domain';

export interface JsRule {
  pattern: string; // contentSettings primary pattern
  setting: JsSetting;
  addedAt: number;
}

/** `https://shop.acme.com/x` → `*://shop.acme.com/*` (host) or `*://[*.]acme.com/*` (domain). */
export function patternFor(url: string, scope: RuleScope, site: (host: string) => string): string {
  const u = new URL(url);
  if (u.protocol === 'file:') return 'file:///*';
  // An IP address has no domain to widen to; its rule covers that address only.
  const ip = /^\d+(\.\d+){3}$/.test(u.hostname) || u.hostname.startsWith('[');
  const host = scope === 'domain' && !ip ? `[*.]${site(u.hostname)}` : u.hostname;
  return `*://${host}/*`;
}

/** Human label for a pattern, e.g. "[*.]acme.com" or "shop.acme.com". */
export function patternLabel(pattern: string): string {
  return pattern
    .replace(/^\*:\/\//, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/\*$/, '');
}

export function upsertRule(rules: JsRule[], rule: JsRule): JsRule[] {
  return [rule, ...rules.filter((r) => r.pattern !== rule.pattern)];
}

export function exportRules(rules: JsRule[]): string {
  return JSON.stringify(rules, null, 2);
}

/**
 * contentSettings pattern grammar: scheme://host/path, `*` or http(s) or file scheme, a host
 * that is `*`, a name optionally prefixed with `[*.]`, or empty for file; no other wildcards.
 */
export function isValidPattern(p: string): boolean {
  if (p === '<all_urls>') return true;
  const m = /^(\*|https?|file):\/\/([^/\s]*)(\/.*)$/.exec(p);
  if (!m) return false;
  const host = m[2];
  if (m[1] === 'file') return host === '';
  return host === '*' || /^(\[\*\.\])?[a-z0-9.-]+(:(\d+|\*))?$/i.test(host);
}
