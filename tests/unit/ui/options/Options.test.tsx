import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { JsRule } from '../../../../src/lib/jsRules';
import type { Settings } from '../../../../src/lib/settings';
import { Options } from '../../../../src/options/Options';
import { SIGNED_IN, SIGNED_OUT, mockSend, settingsFixture, setupData } from '../fixtures';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);
vi.mock('../../../../src/lib/messages', () => ({ send: vi.fn() }));

const RULES: JsRule[] = [
  { pattern: '*://[*.]ads.com/*', setting: 'block', addedAt: Date.UTC(2026, 8, 1) },
  { pattern: '*://shop.example.com/*', setting: 'allow', addedAt: 0 },
];

let data: ReturnType<typeof setupData>;
let send: ReturnType<typeof mockSend>;
let stored: Settings;
let rules: JsRule[];
let signIn: () => unknown;

beforeEach(() => {
  fakeBrowser.reset();
  data = setupData();
  stored = settingsFixture();
  rules = RULES;
  signIn = () => ({ ok: true, data: SIGNED_IN });
  data.settings.mockImplementation(async () => stored);
  data.saveSettings.mockImplementation(async (patch) => (stored = { ...stored, ...patch }));
  send = mockSend({
    'js:rules': () => rules,
    'js:saveRules': (r) => (rules = r.rules),
    'auth:state': () => SIGNED_OUT,
    'auth:signIn': () => signIn() as never,
    'auth:signOut': () => SIGNED_OUT,
  });
});
afterEach(cleanup);

async function renderOptions() {
  const view = render(<Options />);
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  await screen.findByText('[*.]ads.com');
  return view;
}

const block = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const savedRules = () =>
  (send.mock.calls.filter(([t]) => t === 'js:saveRules').at(-1)![1] as { rules: JsRule[] }).rules;

describe('Options', () => {
  it('renders nothing until the settings are read, then every section', async () => {
    let resolve!: (s: Settings) => void;
    data.settings.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = render(<Options />);
    expect(container.innerHTML).toBe('');
    resolve(stored);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['#account', '#js', '#icon', '#privacy', '#keys']);
  });

  it('shows the Terms screen instead of the settings until the Terms in force are accepted', async () => {
    stored = settingsFixture({ termsAccepted: '' });
    render(<Options />);
    await screen.findByRole('button', { name: 'Agree and continue' });
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });
});

describe('JavaScript rules', () => {
  it('lists the stored rules', async () => {
    await renderOptions();
    const js = block('JavaScript rules');
    expect(within(js).getByText('Domain and subdomains')).toBeTruthy();
    expect(within(js).getByText('This host only')).toBeTruthy();
    expect(within(js).getByText('Sep 1, 2026')).toBeTruthy();
    expect(
      (
        within(js).getByRole('combobox', {
          name: 'JavaScript on shop.example.com',
        }) as HTMLSelectElement
      ).value,
    ).toBe('allow');
  });

  it('blocks a host typed as a URL, on Enter', async () => {
    await renderOptions();
    const input = screen.getByRole('textbox', {
      name: 'Host to block JavaScript on',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '  https://news.example.com/path?q=1 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('news.example.com');
    expect(savedRules()[0]).toMatchObject({ pattern: '*://news.example.com/*', setting: 'block' });
    expect(savedRules()).toHaveLength(3);
    expect(input.value).toBe('');
  });

  it('blocks a whole domain from the button, replacing an existing rule for it', async () => {
    await renderOptions();
    fireEvent.input(screen.getByRole('textbox', { name: 'Host to block JavaScript on' }), {
      target: { value: '[*.]ads.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block JavaScript' }));
    await waitFor(() =>
      expect(savedRules().map((r) => r.pattern)).toEqual([
        '*://[*.]ads.com/*',
        '*://shop.example.com/*',
      ]),
    );
  });

  it('refuses an invalid or empty host', async () => {
    await renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Block JavaScript' }));
    expect(
      screen.getByText('Enter a host such as shop.example.com or [*.]example.com'),
    ).toBeTruthy();
    fireEvent.input(screen.getByRole('textbox', { name: 'Host to block JavaScript on' }), {
      target: { value: 'not a host' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Host to block JavaScript on' }), {
      key: 'a',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block JavaScript' }));
    expect(
      screen.getByText('Enter a host such as shop.example.com or [*.]example.com'),
    ).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith('js:saveRules', expect.anything());
  });

  it('changes and removes single rules, and removes all', async () => {
    await renderOptions();
    fireEvent.change(screen.getByRole('combobox', { name: 'JavaScript on [*.]ads.com' }), {
      target: { value: 'allow' },
    });
    await waitFor(() =>
      expect(savedRules()[0]).toMatchObject({ pattern: '*://[*.]ads.com/*', setting: 'allow' }),
    );

    fireEvent.click(
      within(block('JavaScript rules')).getAllByRole('button', { name: 'Remove' })[1],
    );
    await waitFor(() => expect(savedRules().map((r) => r.pattern)).toEqual(['*://[*.]ads.com/*']));

    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(await screen.findByText('No rules yet. JavaScript runs everywhere.')).toBeTruthy();
    expect(savedRules()).toEqual([]);
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('exports the rules as a JSON download', async () => {
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:rules'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('vitalsentinel-js-rules.json');
      expect(this.href).toBe('blob:rules');
    });
    await renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(click).toHaveBeenCalledOnce();
    expect(JSON.parse(await blob!.text())).toEqual(RULES);
    click.mockRestore();
  });
});

describe('toggles', () => {
  it.each([
    ['Show Domain Rating on the badge', 'showDrBadge', true],
    ['Colour the badge by Core Web Vitals', 'cwvBadgeColour', false],
    ['Domain Rating lookup', 'drConsent', false],
    ['Remember pages', 'rememberChanges', true],
    ['Offline mode', 'offline', false],
  ] as const)(
    '%s persists through saveSettings and refreshes the badge',
    async (label, key, initial) => {
      await renderOptions();
      const sw = screen.getByRole('switch', { name: label });
      expect(sw.getAttribute('aria-checked')).toBe(String(initial));
      fireEvent.click(sw);
      await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe(String(!initial)));
      expect(data.saveSettings).toHaveBeenCalledWith({ [key]: !initial });
      expect(send).toHaveBeenCalledWith('badge:refresh', {});
    },
  );
});

describe('history, account and shortcuts', () => {
  it('clears the stored page summaries only', async () => {
    await fakeBrowser.storage.local.set({
      'digest:https://a.com/': { at: 1 },
      'digest-index': [['digest:https://a.com/', 1]],
      settings: { offline: true },
    });
    await renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(await screen.findByText('✓ Cleared 1 page')).toBeTruthy();
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['settings']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(await screen.findByText('✓ Nothing to clear')).toBeTruthy();
  });

  it('says when the history could not be cleared', async () => {
    await renderOptions();
    vi.spyOn(fakeBrowser.storage.local, 'remove').mockRejectedValueOnce(new Error('quota'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(await screen.findByText('Could not clear the history')).toBeTruthy();
  });

  it('deletes the stored page summaries when remembering is switched off, not on', async () => {
    const history = {
      'digest:https://a.com/': { at: 1 },
      'digest-index': [['digest:https://a.com/', 1]],
    };
    await fakeBrowser.storage.local.set({ ...history, settings: { offline: true } });
    stored = settingsFixture({ rememberChanges: false });
    await renderOptions();
    const sw = screen.getByRole('switch', { name: 'Remember pages' });
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toHaveLength(3);

    fireEvent.click(sw);
    await waitFor(async () =>
      expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['settings']),
    );
    expect(data.saveSettings).toHaveBeenLastCalledWith({ rememberChanges: false });
  });

  it('signs in and out', async () => {
    await renderOptions();
    const account = block('Account');
    expect(
      await within(account).findByText('Monitor one domain free with VitalSentinel'),
    ).toBeTruthy();
    expect(
      within(account).getByRole('link', { name: 'Start free' }).getAttribute('href'),
    ).toContain('/register?utm_source=extension&utm_medium=settings');
    fireEvent.click(within(account).getByRole('button', { name: 'Sign in with VitalSentinel' }));
    expect(await within(account).findByText('Signed in')).toBeTruthy();
    expect(within(account).getByText('Signed in with VitalSentinel')).toBeTruthy();
    expect(within(account).getByText('Workspace')).toBeTruthy();
    expect(
      within(account)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Acme']);
    fireEvent.click(within(account).getByRole('button', { name: 'Sign out' }));
    expect(
      await within(account).findByText('Monitor one domain free with VitalSentinel'),
    ).toBeTruthy();
    expect(send).toHaveBeenCalledWith('auth:signOut', {});
  });

  it('shows a failed sign-in, and a signed-in state without workspaces', async () => {
    signIn = () => ({ ok: false, status: 0, error: 'The sign-in window was closed.' });
    await renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with VitalSentinel' }));
    expect(await screen.findByText('The sign-in window was closed.')).toBeTruthy();
    cleanup();

    mockSend({
      'js:rules': () => RULES,
      'auth:state': () => ({ signedIn: true, workspaces: [], roles: {} }),
    });
    await renderOptions();
    expect(await screen.findByText('Signed in')).toBeTruthy();
    expect(screen.queryByText(/^Workspace/)).toBeNull();
  });

  it('names the signed-in user and lists every workspace', async () => {
    mockSend({
      'js:rules': () => RULES,
      'auth:state': () => ({
        signedIn: true,
        user: 'Ada Lovelace',
        roles: {},
        workspaces: [
          { id: 'a', name: 'Acme', plan: null },
          { id: 'b', name: 'Beta Co', plan: null },
        ],
      }),
    });
    await renderOptions();
    const account = block('Account');
    expect(await within(account).findByText('Ada Lovelace')).toBeTruthy();
    expect(within(account).getByText('AL')).toBeTruthy();
    expect(within(account).getByText('Workspaces · 2')).toBeTruthy();
    expect(
      within(account)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Acme', 'Beta Co']);
  });

  it('opens the browser shortcut settings', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    await renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcuts' }));
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
  });
});

describe('section nav', () => {
  // Drives the scroll-spy by hand: the first observer watches the sections, the second the end.
  const observers: { cb: IntersectionObserverCallback; targets: Element[] }[] = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        targets: Element[] = [];
        constructor(cb: IntersectionObserverCallback) {
          observers.push({ cb, targets: this.targets });
        }
        observe(el: Element) {
          this.targets.push(el);
        }
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const show = (i: number, ids: string[], on = true) =>
    observers[i].cb(
      observers[i].targets
        .filter((t) => !ids.length || ids.includes(t.id))
        .map((target) => ({ target, isIntersecting: on }) as IntersectionObserverEntry),
      {} as IntersectionObserver,
    );
  const current = () =>
    within(screen.getByRole('navigation', { name: 'Settings' }))
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'true')
      .map((a) => a.getAttribute('href'));

  it('marks the section in view, and the last one at the end of the page', async () => {
    await renderOptions();
    expect(current()).toEqual(['#account']);
    // An unscrolled page with its end already in view keeps the first section.
    show(1, []);
    expect(current()).toEqual(['#account']);
    show(1, [], false);
    vi.stubGlobal('scrollY', 400);
    show(0, ['js'], false);
    show(0, ['privacy', 'keys']);
    await waitFor(() => expect(current()).toEqual(['#privacy']));
    show(1, []);
    await waitFor(() => expect(current()).toEqual(['#keys']));
    show(1, [], false);
    await waitFor(() => expect(current()).toEqual(['#privacy']));
  });

  it('scrolls smoothly to a clicked section and holds it until the scroll ends', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await renderOptions();
    fireEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth' });
    expect(document.activeElement).toBe(document.getElementById('account'));
    expect(location.hash).toBe('#account');
    await waitFor(() => expect(current()).toEqual(['#account']));

    // Sections passed on the way, or the end coming into view, do not take over mid-scroll.
    vi.stubGlobal('scrollY', 400);
    show(1, []);
    expect(current()).toEqual(['#account']);
    fireEvent(window, new Event('scrollend'));
    show(0, ['icon']);
    await waitFor(() => expect(current()).toEqual(['#keys']));
  });

  it('lets go of a click that scrolls nothing after a second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Element.prototype.scrollIntoView = vi.fn();
    await renderOptions();
    show(0, ['js']);
    fireEvent.click(screen.getByRole('link', { name: 'Account' }));
    await waitFor(() => expect(current()).toEqual(['#account']));
    show(0, ['js']);
    expect(current()).toEqual(['#account']);
    vi.advanceTimersByTime(1000);
    await waitFor(() => expect(current()).toEqual(['#js']));
    vi.useRealTimers();
  });

  it('lets go of the hold on a key press or wheel', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await renderOptions();
    show(0, ['js']);
    for (const release of [() => fireEvent.keyDown(window), () => fireEvent.wheel(window)]) {
      fireEvent.click(screen.getByRole('link', { name: 'Account' }));
      await waitFor(() => expect(current()).toEqual(['#account']));
      release();
      await waitFor(() => expect(current()).toEqual(['#js']));
    }
  });
});

describe('copy', () => {
  it('asks for no Google key and has no CrUX settings', async () => {
    await renderOptions();
    expect(screen.queryByText(/quota|API key/)).toBeNull();
    expect(screen.getAllByText(/Never the pages you visit\./)).toHaveLength(1);
  });

  it('turns usage statistics and error reports on and off with one switch', async () => {
    await renderOptions();
    const sw = screen.getByRole('switch', { name: 'Share usage and error counts' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() =>
      expect(data.saveSettings).toHaveBeenCalledWith({ usageStats: true, errorReports: true }),
    );
  });
});
