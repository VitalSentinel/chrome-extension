import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { matchDomain } from '../lib/app';
import type { Message, Requests, TabContext } from '../lib/messages';
import { SETTINGS_KEY } from '../lib/settings';
import type { TabVitals } from '../lib/types';
import { isUsageEvent } from '../lib/usage';
import { isWebUrl } from '../lib/url';
import {
  authState,
  domains,
  forgetAccount,
  unwatchPage,
  urlOverview,
  watchPage,
} from '../background/api';
import { AuthError, isSignedIn, onSessionLost, signIn, signOut } from '../background/auth';
import { cwvRating, paint } from '../background/badge';
import { domainRating, pruneDr } from '../background/dr';
import { jsSetting, listRules, saveRules, setJs, toggleJs } from '../background/javascript';
import { getNav, startNavigation } from '../background/navigation';
import { getSession, getSettings, setSession } from '../background/store';
import { count, pruneUsage, sendDue } from '../background/usage';

const vitalsKey = (tabId: number) => `vitals:${tabId}`;

/** From the cached domain list only; the popup reloads once a background load lands. */
async function monitoredFor(url: string) {
  if (!isWebUrl(url) || !(await isSignedIn())) return null;
  return matchDomain(await domains(false), new URL(url).hostname);
}

// The latest refresh per tab; a slower, older one must not paint over a newer page.
const refreshes = new Map<number, number>();
let refreshSeq = 0;

/** Light work for every navigation: DR, JS state, badge. */
async function refreshTab(tabId: number, url: string | undefined, incognito = false) {
  if (!isWebUrl(url)) return;
  const seq = ++refreshSeq;
  refreshes.set(tabId, seq);
  const settings = await getSettings();
  const host = new URL(url).hostname;
  const [{ dr }, js, vitals] = await Promise.all([
    // Never for incognito tabs: their hosts stay in the browser.
    settings.showDrBadge && !incognito ? domainRating(host) : Promise.resolve({ dr: null }),
    jsSetting(url, incognito),
    getSession<TabVitals>(vitalsKey(tabId)),
  ]);
  if (refreshes.get(tabId) !== seq) return;
  await paint(tabId, {
    host,
    dr: dr?.domainRating ?? null,
    showDr: settings.showDrBadge,
    js,
    cwv: settings.cwvBadgeColour ? cwvRating(vitals ?? null) : null,
  });
}

async function tabContext(tabId: number): Promise<TabContext> {
  const tab = await browser.tabs.get(tabId);
  const url = tab.url ?? '';
  const [nav, vitals, js, auth, monitored] = await Promise.all([
    getNav(tabId),
    getSession<TabVitals>(vitalsKey(tabId)),
    jsSetting(url, tab.incognito),
    authState(false),
    monitoredFor(url),
  ]);
  return {
    tabId,
    url,
    title: tab.title ?? '',
    incognito: tab.incognito,
    nav,
    vitals: vitals ?? null,
    js,
    auth,
    monitored,
  };
}

type Handlers = {
  [K in keyof Requests]: (
    req: Requests[K]['req'],
    sender: Browser.runtime.MessageSender,
  ) => Promise<Requests[K]['res']>;
};

const handlers: Handlers = {
  'tab:context': ({ tabId }) => tabContext(tabId),
  'auth:signIn': async () => {
    try {
      await signIn();
      await forgetAccount();
      // Load the account and its domains now, while "Signing in…" shows, so the next popup
      // opens from the cache.
      const [auth] = await Promise.all([authState(), domains()]);
      return { ok: true, data: auth };
    } catch (e) {
      void count('error.signin');
      return {
        ok: false,
        status: 0,
        error: e instanceof AuthError || e instanceof Error ? e.message : 'Sign-in failed.',
      };
    }
  },
  'auth:signOut': async () => {
    await signOut();
    await forgetAccount();
    return authState();
  },
  // Waits for the account and the domain list; Settings and the popup's Try again use it.
  'auth:state': async () => (await Promise.all([authState(), domains()]))[0],
  'app:overview': async ({ domainId, url, refresh }) => {
    const res = await urlOverview(domainId, url, refresh);
    if (!res.ok && (res.status === 0 || res.status >= 500)) void count('error.app');
    return res;
  },
  'app:watch': ({ domainId, url }) => watchPage(domainId, url),
  'app:unwatch': ({ domainId, watchId }) => unwatchPage(domainId, watchId),
  'js:set': async ({ tabId, url, setting, scope }) => {
    const tab = await browser.tabs.get(tabId);
    const result = await setJs(url, setting, scope, tab.incognito);
    if (!tab.incognito) void count('js.popup');
    await browser.tabs.reload(tabId);
    return result;
  },
  'js:rules': () => listRules(),
  'js:saveRules': ({ rules }) => saveRules(rules),
  'vitals:report': async (vitals, sender) => {
    const tabId = sender.tab?.id;
    // Only a well-formed report for the document the tab shows now (not a late one from the
    // page before).
    const page = (u: string | undefined) => (u ?? '').split('#')[0];
    if (
      tabId === undefined ||
      typeof vitals?.metrics !== 'object' ||
      !vitals.metrics ||
      page(vitals.url) !== page(sender.tab?.url)
    )
      return null;
    await setSession(vitalsKey(tabId), vitals);
    if ((await getSettings()).cwvBadgeColour)
      await refreshTab(tabId, sender.tab?.url, sender.tab?.incognito);
    return null;
  },
  'badge:refresh': async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await refreshTab(tab.id, tab.url, tab.incognito);
    return null;
  },
  'usage:count': async ({ event }) => {
    if (isUsageEvent(event)) await count(event);
    return null;
  },
};

export default defineBackground(() => {
  onSessionLost(forgetAccount);
  startNavigation();
  void sendDue();
  void pruneDr();
  // Keep storage.local (the refresh token, the Google key) away from content scripts.
  void Promise.resolve()
    .then(() => browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }))
    .catch(() => {});

  browser.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    // Our own pages only; content scripts (which share the page's renderer) may only report vitals.
    if (sender.id !== browser.runtime.id || !msg || !Object.hasOwn(handlers, msg.type))
      return false;
    const fromContentScript = !!sender.tab && !sender.url?.startsWith(browser.runtime.getURL(''));
    if (fromContentScript && msg.type !== 'vitals:report') return false;
    const handler = handlers[msg.type] as (req: unknown, s: typeof sender) => Promise<unknown>;
    handler(msg, sender).then(sendResponse, (e: Error) => {
      void count('error.worker');
      sendResponse({ __error: e?.message || 'Failed' });
    });
    return true;
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') void count('update');
    // Menus survive browser updates; recreate rather than add a duplicate id.
    void browser.contextMenus.removeAll().then(() =>
      browser.contextMenus.create({
        id: 'toggle-js',
        title: browser.i18n.getMessage('cmdToggleJs'),
        contexts: ['page', 'action'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      }),
    );
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'toggle-js' || !tab) return;
    void toggleJs(tab).then(
      (done) => {
        if (done && !tab.incognito) void count('js.menu');
      },
      () => count('error.worker'),
    );
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-js') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const done = await toggleJs(tab).catch(() => null);
    if (done && !tab.incognito) void count('js.shortcut');
  });

  // A new document (including a reload) starts new measurements; pushState and hash changes
  // keep the page's vitals.
  browser.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId === 0) void browser.storage.session.remove(vitalsKey(d.tabId));
  });

  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url || change.status === 'loading') void refreshTab(tabId, tab.url, tab.incognito);
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    browser.tabs.get(tabId).then(
      (tab) => refreshTab(tabId, tab.url, tab.incognito),
      () => {}, // Closed already.
    );
  });

  const forgetTab = (tabId: number) => {
    refreshes.delete(tabId);
    void browser.storage.session.remove([vitalsKey(tabId), `lastPage:${tabId}`]);
  };
  browser.tabs.onRemoved.addListener(forgetTab);
  // A prerendered page swaps in under a new tab id without onRemoved for the old one.
  browser.tabs.onReplaced.addListener((_added, removed) => forgetTab(removed));

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[SETTINGS_KEY] || changes['js:rules']))
      void handlers['badge:refresh']({}, {});
    // Switching usage statistics or error reports off (or going offline) deletes their counters.
    if (area === 'local' && changes[SETTINGS_KEY]) {
      void pruneUsage().then(() => sendDue());
      void pruneDr();
    }
  });
});
