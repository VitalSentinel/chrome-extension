// robots.txt parsing and matching with Google's semantics (RFC 9309): the most specific
// (longest) matching rule wins, Allow wins a tie, `*` matches any run and `$` anchors the end.
// A crawler uses the groups naming its product token, else the `*` groups.

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

// Google's parser accepts these misspellings, so a site using them is read the same way.
const KEYS: Record<string, string> = {
  'user-agent': 'user-agent',
  useragent: 'user-agent',
  'user agent': 'user-agent',
  allow: 'allow',
  disallow: 'disallow',
  dissallow: 'disallow',
  dissalow: 'disallow',
  disalow: 'disallow',
  diasllow: 'disallow',
  disallaw: 'disallow',
  sitemap: 'sitemap',
  'site-map': 'sitemap',
};

/** Google reads the first 500 KiB of a robots.txt and ignores the rest. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

/** `key: value`, or `key value` when a line has exactly two words and no colon. */
function keyValue(line: string): [string, string] | null {
  const colon = line.indexOf(':');
  if (colon > 0) return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
  const parts = line.split(/\s+/);
  return parts.length === 2 ? [parts[0].toLowerCase(), parts[1]] : null;
}

/** The product token of a User-agent value: `Googlebot/2.1 (+http…)` → `googlebot`. */
function agentToken(value: string): string {
  if (/^\*(\s|$)/.test(value)) return '*';
  return /^[A-Za-z_-]*/.exec(value)![0].toLowerCase();
}

export function parseRobots(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const kv = keyValue(raw.replace(/#.*/, '').trim());
    if (!kv) continue;
    const key = KEYS[kv[0]];
    const value = kv[1];
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      const agent = agentToken(value);
      if (agent) current.agents.push(agent);
      lastWasAgent = true;
      continue;
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if ((key === 'allow' || key === 'disallow') && current) {
      // Only a rule ends a run of User-agent lines (Google's parser); Crawl-delay does not.
      lastWasAgent = false;
      // An empty Disallow allows everything; it adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  return { groups, sitemaps };
}

/** Product token of a user-agent string, e.g. "Googlebot" from "Googlebot/2.1". */
const token = (agent: string) => agent.toLowerCase().split('/')[0].trim();

/** A robots.txt server error (or 429) makes Google treat the whole site as disallowed. */
export const robotsUnavailable = (status: number) => status >= 500 || status === 429;

/**
 * The rules a crawler applies for a robots.txt response, per Google: 2xx is parsed, 4xx
 * (except 429) means no restrictions, and a server error or 429 means nothing may be crawled.
 */
export function robotsForStatus(status: number, text: string): RobotsTxt {
  if (status >= 200 && status < 300) return parseRobots(text);
  if (robotsUnavailable(status))
    return { groups: [{ agents: ['*'], rules: [{ allow: false, path: '/' }] }], sitemaps: [] };
  return { groups: [], sitemaps: [] };
}

const rulesNaming = (robots: RobotsTxt, name: string) =>
  robots.groups.filter((g) => g.agents.includes(name)).flatMap((g) => g.rules);

/**
 * The rules for a crawler: every group naming its product token exactly (groups with the same
 * name merge), else the `*` groups. Google's specialised crawlers such as Googlebot-Image fall
 * back to the Googlebot group before `*`; other names never match by prefix.
 */
export function groupFor(robots: RobotsTxt, agent: string): RobotsRule[] {
  const name = token(agent);
  const named = (n: string) => robots.groups.some((g) => g.agents.includes(n));
  if (named(name)) return rulesNaming(robots, name);
  if (name.startsWith('googlebot-') && named('googlebot')) return rulesNaming(robots, 'googlebot');
  return rulesNaming(robots, '*');
}

/**
 * Whether a robots.txt path pattern matches the start of `target`. Greedy wildcard matching
 * without regular expressions, so a hostile pattern such as `/*a*a*a*a*b` cannot hang the
 * popup: each `*` segment is found with indexOf, left to right, which is linear per segment.
 */
export function matchesRule(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  if (!target.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1 && anchored)
      return target.length - part.length >= pos && target.endsWith(part);
    const at = target.indexOf(part, pos);
    if (at < 0) return false;
    pos = at + part.length;
  }
  return !anchored || pos === target.length;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface RobotsVerdict {
  allowed: boolean;
  rule: RobotsRule | null;
}

export function isAllowed(robots: RobotsTxt, agent: string, url: string): RobotsVerdict {
  const u = new URL(url);
  const target = decodeSafe(u.pathname + u.search);
  let best: RobotsRule | null = null;
  for (const rule of groupFor(robots, agent)) {
    if (!matchesRule(decodeSafe(rule.path), target)) continue;
    const len = rule.path.length;
    if (
      !best ||
      len > best.path.length ||
      (len === best.path.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return { allowed: !best || best.allow, rule: best };
}

export const SEARCH_CRAWLERS = [
  'Googlebot',
  'Googlebot-Image',
  'Bingbot',
  'DuckDuckBot',
  'YandexBot',
  'Applebot',
];
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
  'Applebot-Extended',
  'Meta-ExternalAgent',
  'Bytespider',
  'Amazonbot',
];
