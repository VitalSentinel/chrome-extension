import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../../src/entrypoints/background';
import {
  authState,
  domains,
  forgetAccount,
  urlOverview,
  unwatchPage,
  watchPage,
} from '../../../src/background/api';
import {
  AuthError,
  isSignedIn,
  onSessionLost,
  signIn,
  signOut,
} from '../../../src/background/auth';
import { paint } from '../../../src/background/badge';
import { domainRating } from '../../../src/background/dr';
import {
  jsSetting,
  listRules,
  saveRules,
  setJs,
  toggleJs,
} from '../../../src/background/javascript';
import { getNav, startNavigation } from '../../../src/background/navigation';
import { count, pruneUsage, sendDue } from '../../../src/background/usage';
import type { Domain } from '../../../src/lib/app';
import type { AuthState, Message } from '../../../src/lib/messages';
import { TERMS_VERSION } from '../../../src/lib/config';
import { SETTINGS_KEY, type Settings } from '../../../src/lib/settings';
import type { TabVitals } from '../../../src/lib/types';
import { nav } from '../fixtures';

// The real store and badge maths; everything that talks to the network or Chrome APIs the
// fake browser lacks is mocked per module.
vi.mock('../../../src/background/api', () => ({
  authState: vi.fn(),
  domains: vi.fn(),
  forgetAccount: vi.fn(),
  pruneOverviews: vi.fn(async () => {}),
  unwatchPage: vi.fn(),
  urlOverview: vi.fn(),
  watchPage: vi.fn(),
}));
vi.mock('../../../src/background/auth', async (orig) => ({
  AuthError: (await orig<typeof import('../../../src/background/auth')>()).AuthError,
  isSignedIn: vi.fn(),
  onSessionLost: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../../src/background/badge', async (orig) => ({
  ...(await orig<object>()),
  paint: vi.fn(),
}));
vi.mock('../../../src/background/dr', () => ({
  domainRating: vi.fn(),
  pruneDr: vi.fn(async () => {}),
}));
vi.mock('../../../src/background/javascript', () => ({
  jsSetting: vi.fn(),
  listRules: vi.fn(),
  saveRules: vi.fn(),
  setJs: vi.fn(),
  toggleJs: vi.fn(),
}));
vi.mock('../../../src/background/usage', () => ({
  pruneUsage: vi.fn(async () => {}),
  count: vi.fn(async () => {}),
  sendDue: vi.fn(async () => {}),
}));
vi.mock('../../../src/background/navigation', () => ({
  getNav: vi.fn(),
  startNavigation: vi.fn(),
}));

type Tab = { id: number; url?: string; title?: string; incognito: boolean };
const PAGE = 'https://www.example.com/pricing';
const tab: Tab = { id: 7, url: PAGE, title: 'Pricing – Example', incognito: false };
const domain: Domain = {
  id: 'dom_1',
  workspace_id: 'ws_1',
  domain: 'example.com',
  active_modules: [],
};
const signedIn: AuthState = {
  signedIn: true,
  workspaces: [{ id: 'ws_1', name: 'Acme', plan: 'pro' }],
  roles: { ws_1: 'owner' },
};
const dr = {
  domain: 'example.com',
  domainRating: 71,
  fetchedAt: '2026-09-28T08:00:00Z',
  stale: false,
};
const vitals = (url = PAGE): TabVitals => ({
  url,
  metrics: {
    LCP: { name: 'LCP', value: 4_800, rating: 'poor' },
    CLS: { name: 'CLS', value: 0.01, rating: 'good' },
  },
  shifts: [],
});

let tabs: {
  get: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
};
let contextMenus: {
  create: ReturnType<typeof vi.fn>;
  onClicked: (info: { menuItemId: string }, tab?: Tab) => void;
};
let onCommand: (command: string) => Promise<void>;

const POPUP = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' };
const CONTENT = { id: 'test-extension-id', url: PAGE, tab, frameId: 0 };

/** Sends a message to the router; resolves with the response, or 'unhandled'. */
function dispatch(
  msg: Message | { type: string } | null,
  sender: object = POPUP,
): Promise<unknown> {
  return new Promise((resolve) => {
    void fakeBrowser.runtime.onMessage.trigger(msg, sender, resolve).then((r: unknown[]) => {
      if (!r.includes(true)) resolve('unhandled');
    });
  });
}

const setSettings = async (s: Partial<Settings>) => {
  await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { termsAccepted: TERMS_VERSION, ...s } });
  await settle();
  vi.mocked(paint).mockClear();
};
/** Lets the router's fire-and-forget work (`void refreshTab(…)`) finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

let replaced: (added: number, removed: number) => void;
beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { termsAccepted: TERMS_VERSION } });

  tabs = {
    get: vi.fn(async (id: number) =>
      id === tab.id ? tab : { id, url: 'chrome://newtab/', incognito: false },
    ),
    query: vi.fn(async () => [tab]),
    create: vi.fn(async () => ({})),
    reload: vi.fn(async () => {}),
  };
  Object.assign(fakeBrowser.tabs, tabs);
  contextMenus = { create: vi.fn(), onClicked: () => {} };
  fakeBrowser.contextMenus = {
    create: contextMenus.create,
    removeAll: vi.fn(async () => {}),
    onClicked: {
      addListener: (cb: typeof contextMenus.onClicked) => (contextMenus.onClicked = cb),
    },
  } as never;
  fakeBrowser.commands = {
    onCommand: { addListener: (cb: typeof onCommand) => (onCommand = cb) },
  } as never;
  fakeBrowser.i18n.getMessage = vi.fn(() => 'Toggle JavaScript') as never;

  vi.mocked(isSignedIn).mockResolvedValue(true);
  vi.mocked(domains).mockResolvedValue([domain]);
  vi.mocked(authState).mockResolvedValue(signedIn);
  vi.mocked(domainRating).mockResolvedValue({ dr, error: null });
  vi.mocked(jsSetting).mockResolvedValue('allow');
  vi.mocked(toggleJs).mockResolvedValue('block');
  vi.mocked(getNav).mockResolvedValue(nav({ tabId: 7, url: PAGE }));

  fakeBrowser.storage.local.setAccessLevel = vi.fn(async () => {}) as never;
  // fakeBrowser has no onReplaced; keep the listener to call it by hand.
  Object.assign(fakeBrowser.tabs, {
    onReplaced: { addListener: (cb: typeof replaced) => (replaced = cb) },
  });
  background.main();
});
afterEach(() => vi.restoreAllMocks());

describe('main', () => {
  it('starts navigation recording and sends any finished usage day', async () => {
    await settle();
    expect(fakeBrowser.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(startNavigation).toHaveBeenCalledOnce();
    expect(sendDue).toHaveBeenCalledOnce();
  });

  it('has auth forget the cached account when a refresh ends the session', () => {
    expect(onSessionLost).toHaveBeenCalledWith(forgetAccount);
  });

  it.each([
    { name: 'an unknown type', msg: { type: 'overlay' } },
    { name: 'an inherited property name', msg: { type: 'toString' } },
    { name: 'no message', msg: null },
  ])('leaves $name to other listeners', async ({ msg }) => {
    expect(await dispatch(msg)).toBe('unhandled');
  });

  it('ignores messages from other extensions', async () => {
    expect(
      await dispatch(
        { type: 'auth:state' },
        {
          id: 'abcdefghijklmnopabcdefghijklmnop',
          url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/page.html',
        },
      ),
    ).toBe('unhandled');
    expect(authState).not.toHaveBeenCalled();
  });

  it('accepts only vitals reports from content scripts', async () => {
    expect(await dispatch({ type: 'auth:signOut' }, CONTENT)).toBe('unhandled');
    expect(await dispatch({ type: 'tab:context', tabId: 7 }, CONTENT)).toBe('unhandled');
    expect(signOut).not.toHaveBeenCalled();
    expect(await dispatch({ type: 'vitals:report', ...vitals() }, CONTENT)).toBeNull();
  });

  it('accepts the popup opened in a tab of its own', async () => {
    const popupTab = {
      id: 12,
      url: 'chrome-extension://test-extension-id/popup.html?tab=7',
      incognito: false,
    };
    expect(
      await dispatch({ type: 'auth:state' }, { ...POPUP, url: popupTab.url, tab: popupTab }),
    ).toEqual(signedIn);
  });

  it.each([
    {
      name: 'its message',
      err: new Error('storage quota exceeded'),
      error: 'storage quota exceeded',
    },
    { name: 'a fallback', err: new Error(''), error: 'Failed' },
  ])('answers a failing handler with $name as __error', async ({ err, error }) => {
    vi.mocked(authState).mockRejectedValue(err);
    expect(await dispatch({ type: 'auth:state' })).toEqual({ __error: error });
  });
});

describe('tab:context', () => {
  it('collects everything the popup needs for a monitored page', async () => {
    await fakeBrowser.storage.session.set({ 'vitals:7': vitals() });

    expect(await dispatch({ type: 'tab:context', tabId: 7 })).toEqual({
      tabId: 7,
      url: PAGE,
      title: 'Pricing – Example',
      incognito: false,
      nav: nav({ tabId: 7, url: PAGE }),
      vitals: vitals(),
      js: 'allow',
      auth: signedIn,
      monitored: domain,
    });
    // Only what the worker has cached: the context never waits for the API.
    expect(authState).toHaveBeenCalledWith(false);
    expect(domains).toHaveBeenCalledWith(false);
    // DR is the popup's own request now, not part of the context.
    expect(domainRating).not.toHaveBeenCalled();
  });

  it('has no vitals before the content script reported', async () => {
    expect(await dispatch({ type: 'tab:context', tabId: 7 })).toMatchObject({ vitals: null });
  });

  it('skips monitoring for a non-web page', async () => {
    const ctx = await dispatch({ type: 'tab:context', tabId: 3 });
    expect(ctx).toMatchObject({
      url: 'chrome://newtab/',
      title: '',
      monitored: null,
    });
    expect(domains).not.toHaveBeenCalled();
  });

  it('has no monitored domain when signed out', async () => {
    vi.mocked(isSignedIn).mockResolvedValue(false);
    expect(await dispatch({ type: 'tab:context', tabId: 7 })).toMatchObject({
      monitored: null,
    });
    expect(domains).not.toHaveBeenCalled();
  });
});

describe('auth messages', () => {
  it('signs in, forgets the old account cache, warms the new one and returns its state', async () => {
    expect(await dispatch({ type: 'auth:signIn' })).toEqual({ ok: true, data: signedIn });
    expect(signIn).toHaveBeenCalledOnce();
    expect(forgetAccount).toHaveBeenCalledOnce();
    expect(domains).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'an AuthError',
      err: new AuthError('Sign-in was cancelled.'),
      error: 'Sign-in was cancelled.',
    },
    { name: 'any Error', err: new TypeError('Failed to fetch'), error: 'Failed to fetch' },
    { name: 'a non-Error', err: 'nope', error: 'Sign-in failed.' },
  ])('reports $name from sign-in', async ({ err, error }) => {
    vi.mocked(signIn).mockRejectedValue(err);
    expect(await dispatch({ type: 'auth:signIn' })).toEqual({ ok: false, status: 0, error });
    expect(forgetAccount).not.toHaveBeenCalled();
  });

  it('signs out and forgets the account cache', async () => {
    vi.mocked(authState).mockResolvedValue({ signedIn: false, workspaces: [], roles: {} });
    expect(await dispatch({ type: 'auth:signOut' })).toEqual({
      signedIn: false,
      workspaces: [],
      roles: {},
    });
    expect(signOut).toHaveBeenCalledOnce();
    expect(forgetAccount).toHaveBeenCalledOnce();
  });

  it('returns the auth state once the account and the domain list are loaded', async () => {
    let domainsLoaded!: () => void;
    vi.mocked(domains).mockReturnValue(new Promise<Domain[]>((r) => (domainsLoaded = () => r([]))));
    let settled = false;
    const answer = dispatch({ type: 'auth:state' }).then((a) => {
      settled = true;
      return a;
    });
    await vi.waitFor(() => expect(domains).toHaveBeenCalledWith());
    expect(authState).toHaveBeenCalledWith();
    expect(settled).toBe(false);
    domainsLoaded();
    expect(await answer).toEqual(signedIn);
  });
});

describe('app, JavaScript and User-Agent messages', () => {
  it('passes overview and watch requests through', async () => {
    vi.mocked(urlOverview).mockResolvedValue({ ok: false, status: 404, error: 'not_found' });
    vi.mocked(watchPage).mockResolvedValue({
      ok: true,
      data: { duplicate: true, watch: { id: 'w1' } },
    });
    vi.mocked(unwatchPage).mockResolvedValue({ ok: true, data: null });
    expect(
      await dispatch({ type: 'app:overview', domainId: 'dom_1', url: PAGE, refresh: true }),
    ).toEqual({ ok: false, status: 404, error: 'not_found' });
    expect(urlOverview).toHaveBeenCalledWith('dom_1', PAGE, true);
    expect(await dispatch({ type: 'app:unwatch', domainId: 'dom_1', watchId: 'w1' })).toEqual({
      ok: true,
      data: null,
    });
    expect(unwatchPage).toHaveBeenCalledWith('dom_1', 'w1');
    expect(await dispatch({ type: 'app:watch', domainId: 'dom_1', url: PAGE })).toEqual({
      ok: true,
      data: { duplicate: true, watch: { id: 'w1' } },
    });
    expect(watchPage).toHaveBeenCalledWith('dom_1', PAGE);
  });

  it('sets a JavaScript rule in the scope of the tab and reloads it', async () => {
    tabs.get.mockResolvedValue({ ...tab, incognito: true });
    vi.mocked(setJs).mockResolvedValue('block');
    expect(
      await dispatch({ type: 'js:set', tabId: 7, url: PAGE, setting: 'block', scope: 'domain' }),
    ).toBe('block');
    expect(setJs).toHaveBeenCalledWith(PAGE, 'block', 'domain', true);
    expect(tabs.reload).toHaveBeenCalledWith(7);
    expect(count).not.toHaveBeenCalled();
  });

  it('counts a JavaScript change from the popup in a normal tab', async () => {
    await dispatch({ type: 'js:set', tabId: 7, url: PAGE, setting: 'block', scope: 'domain' });
    expect(count).toHaveBeenCalledWith('js.popup');
  });

  it('lists and saves rules', async () => {
    const rules = [{ pattern: '*://[*.]example.com/*', setting: 'block' as const, addedAt: 1 }];
    vi.mocked(listRules).mockResolvedValue(rules);
    vi.mocked(saveRules).mockResolvedValue(rules);
    expect(await dispatch({ type: 'js:rules' })).toEqual(rules);
    expect(await dispatch({ type: 'js:saveRules', rules })).toEqual(rules);
    expect(saveRules).toHaveBeenCalledWith(rules);
  });
});

describe('usage:count', () => {
  it('counts listed events only', async () => {
    expect(await dispatch({ type: 'usage:count', event: 'page.links' })).toBeNull();
    expect(
      await dispatch({ type: 'usage:count', event: 'https://example.com/' } as { type: string }),
    ).toBeNull();
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith('page.links');
  });

  it('is refused from a content script', async () => {
    expect(await dispatch({ type: 'usage:count', event: 'popup.open' }, CONTENT)).toBe('unhandled');
    expect(count).not.toHaveBeenCalled();
  });

  it('prunes the counters and sends due days after a settings change', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { usageStats: false } });
    await settle();
    expect(pruneUsage).toHaveBeenCalledOnce();
    expect(sendDue).toHaveBeenCalledTimes(2);
  });

  it('refuses sign-in before the Terms in force are accepted', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { termsAccepted: '' } });
    expect(await dispatch({ type: 'auth:signIn' })).toEqual({
      ok: false,
      status: 0,
      error: 'Accept the Terms first.',
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('does not count an app error from an incognito tab', async () => {
    vi.mocked(urlOverview).mockResolvedValueOnce({ ok: false, status: 503, error: 'down' });
    await dispatch({ type: 'app:overview', domainId: 'dom_1', url: PAGE, incognito: true });
    expect(count).not.toHaveBeenCalled();
  });

  it('counts failed sign-ins, app errors and failed handlers, not app refusals', async () => {
    vi.mocked(signIn).mockRejectedValue(new Error('cancelled'));
    await dispatch({ type: 'auth:signIn' });
    vi.mocked(urlOverview).mockResolvedValueOnce({ ok: false, status: 503, error: 'down' });
    await dispatch({ type: 'app:overview', domainId: 'dom_1', url: PAGE });
    vi.mocked(urlOverview).mockResolvedValueOnce({ ok: false, status: 404, error: 'not_found' });
    await dispatch({ type: 'app:overview', domainId: 'dom_1', url: PAGE });
    vi.mocked(listRules).mockRejectedValue(new Error('boom'));
    await dispatch({ type: 'js:rules' });
    expect(vi.mocked(count).mock.calls).toEqual([
      ['error.signin'],
      ['error.app'],
      ['error.worker'],
    ]);
  });
});

describe('vitals:report', () => {
  it('ignores a report from outside a tab', async () => {
    expect(await dispatch({ type: 'vitals:report', ...vitals() }, POPUP)).toBeNull();
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('stores the report for the tab without repainting by default', async () => {
    expect(await dispatch({ type: 'vitals:report', ...vitals() }, CONTENT)).toBeNull();
    expect((await fakeBrowser.storage.session.get('vitals:7'))['vitals:7']).toMatchObject({
      url: PAGE,
      metrics: vitals().metrics,
    });
    expect(paint).not.toHaveBeenCalled();
  });

  it('repaints the badge in Core Web Vitals colours when opted in', async () => {
    await setSettings({ cwvBadgeColour: true, drConsent: true });
    await dispatch({ type: 'vitals:report', ...vitals() }, CONTENT);
    expect(paint).toHaveBeenCalledWith(7, {
      host: 'www.example.com',
      dr: 71,
      showDr: true,
      js: 'allow',
      cwv: 'poor',
    });
  });
});

describe('badge refresh', () => {
  it('paints the active tab with DR and JS state', async () => {
    vi.mocked(jsSetting).mockResolvedValue('block');
    expect(await dispatch({ type: 'badge:refresh' })).toBeNull();
    expect(paint).toHaveBeenCalledWith(7, {
      host: 'www.example.com',
      dr: 71,
      showDr: true,
      js: 'block',
      cwv: null,
    });
  });

  it('never looks up DR for an incognito tab', async () => {
    tabs.query.mockResolvedValue([{ ...tab, incognito: true }]);
    await dispatch({ type: 'badge:refresh' });
    expect(domainRating).not.toHaveBeenCalled();
    expect(jsSetting).toHaveBeenCalledWith(PAGE, true);
    expect(paint).toHaveBeenCalledWith(7, expect.objectContaining({ dr: null, showDr: true }));
  });

  it('does not look up DR when the badge is off', async () => {
    await setSettings({ showDrBadge: false });
    await dispatch({ type: 'badge:refresh' });
    expect(domainRating).not.toHaveBeenCalled();
    expect(paint).toHaveBeenCalledWith(7, expect.objectContaining({ dr: null, showDr: false }));
  });

  it.each([
    { name: 'there is no active tab', result: [] },
    {
      name: 'the active tab is not a web page',
      result: [{ id: 3, url: 'chrome://settings/', incognito: false }],
    },
  ])('paints nothing when $name', async ({ result }) => {
    tabs.query.mockResolvedValue(result);
    await dispatch({ type: 'badge:refresh' });
    expect(paint).not.toHaveBeenCalled();
  });

  it('repaints when settings or JavaScript rules change', async () => {
    await fakeBrowser.storage.local.set({ 'js:rules': [] });
    await settle();
    expect(paint).toHaveBeenCalledTimes(1);
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { showDrBadge: true } });
    await settle();
    expect(paint).toHaveBeenCalledTimes(2);
  });

  it('ignores other storage changes', async () => {
    await fakeBrowser.storage.local.set({
      'dr:example.com': { at: 1, value: null, error: 'network' },
    });
    await fakeBrowser.storage.session.set({ [SETTINGS_KEY]: {} });
    await settle();
    expect(paint).not.toHaveBeenCalled();
  });
});

describe('tab events', () => {
  it.each([
    { name: 'a URL change', change: { url: PAGE } },
    { name: 'loading', change: { status: 'loading' as const } },
  ])('repaints on $name and keeps the vitals (pushState keeps the page)', async ({ change }) => {
    await fakeBrowser.storage.session.set({ 'vitals:7': vitals() });
    await fakeBrowser.tabs.onUpdated.trigger(7, change, tab as never);
    await settle();
    expect(await fakeBrowser.storage.session.get('vitals:7')).toHaveProperty('vitals:7');
    expect(paint).toHaveBeenCalledWith(7, expect.objectContaining({ host: 'www.example.com' }));
  });

  it('drops the vitals when a new top-level document commits', async () => {
    await fakeBrowser.storage.session.set({ 'vitals:7': vitals(), 'vitals:8': vitals() });
    await fakeBrowser.webNavigation.onCommitted.trigger({ tabId: 8, frameId: 3 } as never);
    await fakeBrowser.webNavigation.onCommitted.trigger({ tabId: 7, frameId: 0 } as never);
    await settle();
    expect(Object.keys(await fakeBrowser.storage.session.get(null))).toEqual(['vitals:8']);
  });

  it('ignores other tab updates', async () => {
    await fakeBrowser.tabs.onUpdated.trigger(
      7,
      { status: 'complete', title: 'Pricing' },
      tab as never,
    );
    await settle();
    expect(paint).not.toHaveBeenCalled();
  });

  it('repaints the tab that becomes active', async () => {
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 7, windowId: 1 });
    await settle();
    expect(tabs.get).toHaveBeenCalledWith(7);
    expect(paint).toHaveBeenCalledWith(7, expect.any(Object));
  });

  it('drops the vitals and the last report page of a closed tab', async () => {
    await fakeBrowser.storage.session.set({
      'vitals:7': vitals(),
      'lastPage:7': { url: PAGE, page: 'schema' },
      'lastPage:8': { url: PAGE, page: 'links' },
    });
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await settle();
    expect(await fakeBrowser.storage.session.get(['vitals:7', 'lastPage:7'])).toEqual({});
    expect(await fakeBrowser.storage.session.get('lastPage:8')).toEqual({
      'lastPage:8': { url: PAGE, page: 'links' },
    });
  });

  it('drops them for a tab replaced by a prerendered page', async () => {
    await fakeBrowser.storage.session.set({ 'lastPage:7': { url: PAGE, page: 'schema' } });
    replaced(9, 7);
    await settle();
    expect(await fakeBrowser.storage.session.get('lastPage:7')).toEqual({});
  });
});

describe('JavaScript toggle shortcuts', () => {
  it('toggles from the context menu item only', async () => {
    contextMenus.onClicked({ menuItemId: 'toggle-js' }, tab);
    contextMenus.onClicked({ menuItemId: 'other' }, tab);
    contextMenus.onClicked({ menuItemId: 'toggle-js' });
    await settle();
    expect(toggleJs).toHaveBeenCalledTimes(1);
    expect(toggleJs).toHaveBeenCalledWith(tab);
    expect(count).toHaveBeenCalledWith('js.menu');
  });

  it('does not count toggles in incognito tabs', async () => {
    const priv = { ...tab, incognito: true };
    contextMenus.onClicked({ menuItemId: 'toggle-js' }, priv);
    await settle();
    tabs.query.mockResolvedValue([priv]);
    await onCommand('toggle-js');
    expect(toggleJs).toHaveBeenCalledTimes(2);
    expect(count).not.toHaveBeenCalled();
  });

  it('toggles the active tab from the keyboard command', async () => {
    await onCommand('toggle-js');
    expect(toggleJs).toHaveBeenCalledWith(tab);
    expect(count).toHaveBeenCalledWith('js.shortcut');
    await onCommand('_execute_action');
    expect(toggleJs).toHaveBeenCalledTimes(1);
    tabs.query.mockResolvedValue([]);
    await onCommand('toggle-js');
    expect(toggleJs).toHaveBeenCalledTimes(1);
  });
});

describe('worker hardening', () => {
  it('ignores a vitals report for another document or without metrics', async () => {
    expect(
      await dispatch({ type: 'vitals:report', ...vitals('https://www.example.com/old') }, CONTENT),
    ).toBeNull();
    expect(await dispatch({ type: 'vitals:report', url: PAGE } as never, CONTENT)).toBeNull();
    expect(await fakeBrowser.storage.session.get('vitals:7')).toEqual({});
  });

  it('lets only the newest refresh of a tab paint the badge', async () => {
    await setSettings({ drConsent: true });
    let slow!: (v: Awaited<ReturnType<typeof domainRating>>) => void;
    vi.mocked(domainRating)
      .mockReturnValueOnce(new Promise((r) => (slow = r)))
      .mockResolvedValueOnce({ dr: { ...dr, domainRating: 12 }, error: null });
    tabs.query.mockResolvedValue([{ ...tab, url: 'https://old.example.org/' }]);
    const first = dispatch({ type: 'badge:refresh' });
    await settle();
    tabs.query.mockResolvedValue([tab]);
    await dispatch({ type: 'badge:refresh' });
    slow({ dr, error: null });
    await first;
    expect(paint).toHaveBeenCalledTimes(1);
    expect(vi.mocked(paint).mock.calls[0][1]).toMatchObject({ host: 'www.example.com', dr: 12 });
  });

  it('ignores a tab that closed before it could be read', async () => {
    tabs.get.mockRejectedValueOnce(new Error('No tab with id: 9.'));
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 9, windowId: 1 });
    await settle();
    expect(paint).not.toHaveBeenCalled();
  });
});

describe('toggle results', () => {
  it('counts nothing when the page cannot be toggled, and a failure as an error', async () => {
    vi.mocked(toggleJs).mockResolvedValueOnce(null);
    await onCommand('toggle-js');
    vi.mocked(toggleJs).mockRejectedValueOnce(new Error('bad pattern'));
    contextMenus.onClicked({ menuItemId: 'toggle-js' }, tab);
    await settle();
    expect(vi.mocked(count).mock.calls).toEqual([['error.worker']]);
  });
});

describe('install', () => {
  it('opens no page on install and creates the context menu', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(contextMenus.create).toHaveBeenCalledWith({
      id: 'toggle-js',
      title: 'Toggle JavaScript',
      contexts: ['page', 'action'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    expect(fakeBrowser.i18n.getMessage).toHaveBeenCalledWith('cmdToggleJs');
    // The install is counted when the Terms are accepted, not here.
    expect(count).not.toHaveBeenCalled();
  });

  it('counts an update', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.9.0' });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(contextMenus.create).toHaveBeenCalledOnce();
    expect(count).toHaveBeenCalledWith('update');
  });
});
