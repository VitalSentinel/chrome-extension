import { browser } from 'wxt/browser';
import {
  patternFor,
  upsertRule,
  type JsRule,
  type JsSetting,
  type RuleScope,
} from '../lib/jsRules';
import { isWebUrl, siteOf } from '../lib/url';
import { getLocal, setLocal } from './store';

// JavaScript switcher on chrome.contentSettings. Chrome keeps the rules itself; the list in
// storage mirrors them for the options page. Incognito rules last for the session only.

const RULES = 'js:rules';

export async function jsSetting(url: string, incognito = false): Promise<JsSetting> {
  if (!isWebUrl(url)) return 'allow';
  const { setting } = await browser.contentSettings.javascript.get({ primaryUrl: url, incognito });
  return setting === 'block' ? 'block' : 'allow';
}

export async function listRules(): Promise<JsRule[]> {
  return (await getLocal<JsRule[]>(RULES)) ?? [];
}

export async function setJs(
  url: string,
  setting: JsSetting,
  scope: RuleScope,
  incognito = false,
): Promise<JsSetting> {
  const pattern = patternFor(url, scope, siteOf);
  await browser.contentSettings.javascript.set({
    primaryPattern: pattern,
    setting,
    scope: incognito ? 'incognito_session_only' : 'regular',
  });
  if (!incognito)
    await setLocal(RULES, upsertRule(await listRules(), { pattern, setting, addedAt: Date.now() }));
  return setting;
}

/**
 * Replaces every rule: Chrome can only clear all of an extension's rules, then re-add. Rules
 * Chrome refuses are dropped, so the stored list always matches what Chrome applies.
 */
export async function saveRules(rules: JsRule[]): Promise<JsRule[]> {
  await browser.contentSettings.javascript.clear({ scope: 'regular' });
  const applied: JsRule[] = [];
  for (const r of rules) {
    try {
      await browser.contentSettings.javascript.set({
        primaryPattern: r.pattern,
        setting: r.setting,
        scope: 'regular',
      });
      applied.push(r);
    } catch {
      // Invalid pattern for Chrome; skip it.
    }
  }
  await setLocal(RULES, applied);
  return applied;
}

export async function toggleJs(tab: {
  id?: number;
  url?: string;
  incognito?: boolean;
}): Promise<JsSetting | null> {
  if (!tab.id || !isWebUrl(tab.url)) return null;
  const next = (await jsSetting(tab.url, tab.incognito)) === 'block' ? 'allow' : 'block';
  await setJs(tab.url, next, 'host', tab.incognito);
  await browser.tabs.reload(tab.id);
  return next;
}
