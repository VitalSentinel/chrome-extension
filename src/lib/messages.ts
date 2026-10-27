import { browser } from 'wxt/browser';
import type { Domain, UrlOverview, WatchCreated, Workspace } from './app';
import type { JsRule, JsSetting, RuleScope } from './jsRules';
import type { NavRecord, TabVitals } from './types';
import type { UsageEvent } from './usage';

// The one message protocol between the popup / options page / content script and the service
// worker. Every request names its type; the worker answers with the matching response.

export interface AuthState {
  signedIn: boolean;
  workspaces: Workspace[];
  roles: Record<string, string>;
  user?: string; // the account's name, else its e-mail, when the app reports them
  // Signed in, but the account or domain list is not cached yet: still loading, or that load
  // just failed. The popup shows that instead of treating the site as not monitored.
  pending?: 'loading' | 'failed';
}

export interface TabContext {
  tabId: number;
  url: string;
  title: string;
  incognito: boolean;
  nav: NavRecord | null;
  vitals: TabVitals | null;
  js: JsSetting;
  auth: AuthState;
  monitored: Domain | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export interface Requests {
  'tab:context': { req: { tabId: number }; res: TabContext };
  'auth:signIn': { req: object; res: ApiResult<AuthState> };
  'auth:signOut': { req: object; res: AuthState };
  'auth:state': { req: object; res: AuthState };
  'app:overview': {
    // incognito: the page's tab, so a failure there is not counted
    req: { domainId: string; url: string; refresh?: boolean; incognito?: boolean };
    res: ApiResult<UrlOverview>;
  };
  'app:watch': { req: { domainId: string; url: string }; res: ApiResult<WatchCreated> };
  'app:unwatch': { req: { domainId: string; watchId: string }; res: ApiResult<null> };
  'js:set': {
    req: { tabId: number; url: string; setting: JsSetting; scope: RuleScope };
    res: JsSetting;
  };
  'js:rules': { req: object; res: JsRule[] };
  'js:saveRules': { req: { rules: JsRule[] }; res: JsRule[] };
  'vitals:report': { req: TabVitals; res: null };
  'badge:refresh': { req: object; res: null };
  'usage:count': { req: { event: UsageEvent }; res: null };
}

export type RequestType = keyof Requests;
export type Message = { [K in RequestType]: { type: K } & Requests[K]['req'] }[RequestType];

/** The worker answers a failed handler with `{ __error }`; it surfaces here as a throw. */
export async function send<K extends RequestType>(
  type: K,
  req: Requests[K]['req'],
): Promise<Requests[K]['res']> {
  const res = await browser.runtime.sendMessage({ type, ...req });
  if (res && typeof res === 'object' && '__error' in res)
    throw new Error(String((res as { __error: unknown }).__error));
  return res as Requests[K]['res'];
}
