import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  jsSetting,
  listRules,
  saveRules,
  setJs,
  toggleJs,
} from '../../../src/background/javascript';
import type { JsRule } from '../../../src/lib/jsRules';

const NOW = Date.UTC(2026, 9, 1);
let js: {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  js = {
    get: vi.fn(async () => ({ setting: 'allow' })),
    set: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  reload = vi.fn(async () => {});
  (fakeBrowser.contentSettings as { javascript: unknown }).javascript = js;
  fakeBrowser.tabs.reload = reload as never;
});
afterEach(() => vi.restoreAllMocks());

describe('jsSetting', () => {
  it.each(['chrome://extensions/', 'about:blank', 'file:///Users/me/page.html', '', undefined])(
    'is allow for the non-web URL %s',
    async (url) => {
      expect(await jsSetting(url as string)).toBe('allow');
      expect(js.get).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['block', 'block'],
    ['allow', 'allow'],
    ['session_only', 'allow'],
  ])('maps the Chrome setting %s to %s', async (setting, expected) => {
    js.get.mockResolvedValue({ setting });
    expect(await jsSetting('https://shop.acme.com/cart', true)).toBe(expected);
    expect(js.get).toHaveBeenCalledWith({
      primaryUrl: 'https://shop.acme.com/cart',
      incognito: true,
    });
  });
});

describe('setJs', () => {
  it.each([
    { scope: 'host', pattern: '*://shop.acme.co.uk/*' },
    { scope: 'domain', pattern: '*://[*.]acme.co.uk/*' },
  ] as const)('sets a $scope rule and mirrors it in storage', async ({ scope, pattern }) => {
    expect(await setJs('https://shop.acme.co.uk/basket?x=1', 'block', scope)).toBe('block');
    expect(js.set).toHaveBeenCalledWith({
      primaryPattern: pattern,
      setting: 'block',
      scope: 'regular',
    });
    expect(await listRules()).toEqual([{ pattern, setting: 'block', addedAt: NOW }]);
  });

  it('replaces an earlier rule for the same pattern, newest first', async () => {
    await setJs('https://a.example.com/', 'block', 'host');
    await setJs('https://b.example.com/', 'block', 'host');
    await setJs('https://a.example.com/other', 'allow', 'host');
    expect((await listRules()).map((r) => [r.pattern, r.setting])).toEqual([
      ['*://a.example.com/*', 'allow'],
      ['*://b.example.com/*', 'block'],
    ]);
  });

  it('keeps an incognito rule for the session only and out of storage', async () => {
    await setJs('https://shop.acme.com/', 'block', 'host', true);
    expect(js.set).toHaveBeenCalledWith({
      primaryPattern: '*://shop.acme.com/*',
      setting: 'block',
      scope: 'incognito_session_only',
    });
    expect(await listRules()).toEqual([]);
  });
});

describe('saveRules', () => {
  it('clears every regular rule, then re-applies the list in order', async () => {
    const rules: JsRule[] = [
      { pattern: '*://[*.]ads.example/*', setting: 'block', addedAt: 1 },
      { pattern: '*://docs.example.com/*', setting: 'allow', addedAt: 2 },
    ];
    expect(await saveRules(rules)).toEqual(rules);
    expect(js.clear).toHaveBeenCalledWith({ scope: 'regular' });
    expect(js.clear.mock.invocationCallOrder[0]).toBeLessThan(js.set.mock.invocationCallOrder[0]);
    expect(js.set.mock.calls).toEqual([
      [{ primaryPattern: '*://[*.]ads.example/*', setting: 'block', scope: 'regular' }],
      [{ primaryPattern: '*://docs.example.com/*', setting: 'allow', scope: 'regular' }],
    ]);
    expect(await listRules()).toEqual(rules);
  });

  it('drops and does not store a rule Chrome refuses', async () => {
    js.set.mockImplementation(async ({ primaryPattern }: { primaryPattern: string }) => {
      if (primaryPattern.includes('*.*')) throw new Error('The pattern is invalid.');
    });
    const good: JsRule = { pattern: '*://docs.example.com/*', setting: 'allow', addedAt: 2 };
    expect(
      await saveRules([{ pattern: '*://*.*.example.com/*', setting: 'block', addedAt: 1 }, good]),
    ).toEqual([good]);
    expect(await listRules()).toEqual([good]);
  });

  it('clears everything for an empty list', async () => {
    await setJs('https://a.example.com/', 'block', 'host');
    await saveRules([]);
    expect(js.clear).toHaveBeenCalledOnce();
    expect(await listRules()).toEqual([]);
  });
});

describe('toggleJs', () => {
  it.each([
    { current: 'allow', next: 'block' },
    { current: 'block', next: 'allow' },
  ])('flips $current to $next for the host and reloads the tab', async ({ current, next }) => {
    js.get.mockResolvedValue({ setting: current });
    expect(await toggleJs({ id: 9, url: 'https://shop.acme.com/p/1', incognito: false })).toBe(
      next,
    );
    expect(js.set).toHaveBeenCalledWith({
      primaryPattern: '*://shop.acme.com/*',
      setting: next,
      scope: 'regular',
    });
    expect(reload).toHaveBeenCalledWith(9);
  });

  it('uses the incognito scope for an incognito tab', async () => {
    await toggleJs({ id: 9, url: 'https://shop.acme.com/', incognito: true });
    expect(js.get).toHaveBeenCalledWith({ primaryUrl: 'https://shop.acme.com/', incognito: true });
    expect(js.set).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'incognito_session_only' }),
    );
  });

  it.each([
    { name: 'no tab id', tab: { url: 'https://shop.acme.com/' } },
    { name: 'a non-web URL', tab: { id: 3, url: 'chrome://newtab/' } },
  ])('does nothing for $name', async ({ tab }) => {
    expect(await toggleJs(tab)).toBeNull();
    expect(js.set).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
