import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '../../../src/popup/App';
import {
  PAGE_URL,
  mockSend,
  settingsFixture,
  setupData,
  stubCanvas,
  tabContext,
  tabVitals,
} from './fixtures';
import { TERMS_VERSION } from '../../../src/lib/config';

vi.mock('../../../src/popup/data', async (orig) =>
  (await import('./mocks')).dataModule(await orig()),
);
vi.mock('../../../src/lib/messages', () => ({ send: vi.fn() }));
// A page chunk that fails to load, as after an extension update while the popup is open.
vi.mock('../../../src/popup/pages/Ai', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  stubCanvas();
  fakeBrowser.reset();
  data = setupData();
  mockSend();
});
afterEach(cleanup);

describe('App', () => {
  it('asks for the Terms before the first report, then shows it', async () => {
    data.settings.mockResolvedValue(settingsFixture({ termsAccepted: '' }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Agree and continue' }));
    expect(await screen.findByRole('navigation', { name: 'Report' })).toBeTruthy();
    expect(data.saveSettings).toHaveBeenCalledWith({
      termsAccepted: TERMS_VERSION,
      drConsent: true,
      errorReports: false,
      usageStats: false,
    });
    expect(data.track).toHaveBeenCalledWith('install');
  });

  it('counts the popup opening, each page shown and a failed analysis', async () => {
    data.snapshot.mockRejectedValue(new Error('This page cannot be analysed.'));
    render(<App />);
    await screen.findByRole('heading', { name: 'This page could not be analysed' });
    expect(data.track).toHaveBeenCalledWith('popup.open');
    expect(data.track).toHaveBeenCalledWith('page.overview');
    expect(data.track).toHaveBeenCalledWith('error.analysis');
  });

  it('shows a loading state until the tab context arrives', () => {
    data.currentTabId.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('shows the error when the tab context cannot be read', async () => {
    data.currentTabId.mockRejectedValue(new Error('No active tab'));
    render(<App />);
    expect(await screen.findByText('No active tab')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains that browser pages cannot be analysed, without injecting anything', async () => {
    data.context.mockResolvedValue(tabContext({ url: 'chrome://extensions/', nav: null }));
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Open a website to see its report' }),
    ).toBeTruthy();
    expect(data.snapshot).not.toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: 'Report' })).toBeTruthy();
  });

  it('shows the analysis error when the snapshot fails', async () => {
    data.snapshot.mockRejectedValue(new Error('This page cannot be analysed.'));
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'This page could not be analysed' }),
    ).toBeTruthy();
    expect(screen.getByText(/The page did not answer/)).toBeTruthy();
    expect(screen.queryByText('This page cannot be analysed.')).toBeNull();
  });

  it('shows another failure as it is, and tries again or reloads the page', async () => {
    data.snapshot.mockRejectedValueOnce(new Error('Cannot access a chrome:// URL'));
    data.snapshot.mockRejectedValueOnce(new Error('Frame was removed'));
    render(<App />);
    expect(await screen.findByText('Cannot access a chrome:// URL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Frame was removed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(await screen.findByRole('navigation', { name: 'Report' })).toBeTruthy();
    await waitFor(() => expect(data.reloadTab).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText('Frame was removed')).toBeNull());
    expect(data.snapshot).toHaveBeenCalledTimes(3);
  });

  it('shows the analysing state, then the Overview once the snapshot resolves', async () => {
    let resolve!: (v: Awaited<ReturnType<typeof data.snapshot>>) => void;
    data.snapshot.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<App />);
    expect(await screen.findByText('Analysing…')).toBeTruthy();
    expect(data.snapshot).toHaveBeenCalledWith(7);

    const { pageSnap } = await import('./fixtures');
    resolve(pageSnap());
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    expect(data.context).toHaveBeenCalledWith(7);
  });

  it('loads another page module from the sidebar', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^Performance/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Performance' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /On-page/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeTruthy();

    // A page visited before comes from the module cache.
    fireEvent.click(screen.getByRole('button', { name: /^Performance/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Performance' })).toBeTruthy();
  });

  it('remembers the page per tab and reopens it with its group expanded', async () => {
    await fakeBrowser.storage.session.set({ 'lastPage:7': { url: PAGE_URL, page: 'images' } });
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Images' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^On-page/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    // The first page counted is the restored one, never a flash of the Overview.
    expect(data.track).not.toHaveBeenCalledWith('page.overview');

    fireEvent.click(screen.getByRole('button', { name: /^Performance/ }));
    await screen.findByRole('heading', { level: 1, name: 'Performance' });
    await waitFor(async () =>
      expect(await fakeBrowser.storage.session.get('lastPage:7')).toEqual({
        'lastPage:7': { url: PAGE_URL, page: 'performance' },
      }),
    );
  });

  it('analyses the page again after Reload page', async () => {
    await fakeBrowser.storage.session.set({ 'lastPage:7': { url: PAGE_URL, page: 'headers' } });
    data.context.mockResolvedValue(tabContext({ nav: null }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload page' }));
    await waitFor(() => expect(data.reloadTab).toHaveBeenCalledWith(7));
    await waitFor(() => expect(data.snapshot).toHaveBeenCalledTimes(2));
  });

  it('starts on the Overview when the tab has moved to another URL', async () => {
    await fakeBrowser.storage.session.set({
      'lastPage:7': { url: 'https://www.example.com/other', page: 'images' },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    await waitFor(async () =>
      expect(await fakeBrowser.storage.session.get('lastPage:7')).toEqual({
        'lastPage:7': { url: PAGE_URL, page: 'overview' },
      }),
    );
  });

  it('follows Core Web Vitals live while the popup is open', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    expect(screen.getByText('1.8 s')).toBeTruthy();

    // Vitals for another URL in the same tab (a navigation) are ignored.
    await fakeBrowser.storage.session.set({
      'vitals:7': tabVitals({ url: 'https://www.example.com/other' }),
    });
    await fakeBrowser.storage.session.set({ unrelated: 1 });
    expect(screen.getByText('1.8 s')).toBeTruthy();

    await fakeBrowser.storage.session.set({
      'vitals:7': tabVitals({
        url: PAGE_URL,
        metrics: { LCP: { name: 'LCP', value: 3200, rating: 'needs-improvement' } },
      }),
    });
    await waitFor(() => expect(screen.getByText('3.2 s')).toBeTruthy());
    expect(screen.queryByText('1.8 s')).toBeNull();
  });

  it('stops listening for vitals and account data when it unmounts', async () => {
    const remove = vi.spyOn(fakeBrowser.storage.session.onChanged, 'removeListener');
    const removeLocal = vi.spyOn(fakeBrowser.storage.local.onChanged, 'removeListener');
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    unmount();
    expect(remove).toHaveBeenCalled();
    expect(removeLocal).toHaveBeenCalled();
  });

  it('takes the new context when the account loads in the background, without re-analysing', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    expect(data.context).toHaveBeenCalledTimes(1);
    expect(data.snapshot).toHaveBeenCalledTimes(1);

    await fakeBrowser.storage.local.set({ 'dr:example.com': { at: 1 } });
    expect(data.context).toHaveBeenCalledTimes(1);

    data.context.mockResolvedValue(
      tabContext({
        auth: {
          signedIn: true,
          workspaces: [{ id: 'ws1', name: 'Acme', plan: null }],
          roles: {},
          user: 'Ada Lovelace',
        },
      }),
    );
    await fakeBrowser.storage.local.set({ 'app:account': { at: 1, value: {} } });
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(data.context).toHaveBeenCalledTimes(2);
    expect(data.snapshot).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest context when an older reload answers last', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    const account = (user: string) =>
      tabContext({ auth: { signedIn: true, workspaces: [], roles: {}, user } });
    let older!: (c: ReturnType<typeof tabContext>) => void;
    data.context.mockReturnValueOnce(new Promise((r) => (older = r)));
    await fakeBrowser.storage.local.set({ 'app:account': { at: 1, value: {} } });
    data.context.mockResolvedValueOnce(account('Newer Account'));
    await fakeBrowser.storage.local.set({ 'app:domains': { at: 1, value: [] } });
    expect(await screen.findByText('Newer Account')).toBeTruthy();
    older(account('Older Account'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Older Account')).toBeNull();
    expect(screen.getByText('Newer Account')).toBeTruthy();
  });

  it('explains a page chunk that fails to load', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^Technical/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'AI readiness' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This report could not be loaded' }),
    ).toBeTruthy();
    expect(screen.getByText('Close and reopen the popup to try again.')).toBeTruthy();
    expect(data.track).toHaveBeenCalledWith('error.report');
    expect(data.track).toHaveBeenCalledWith('page.ai');
  });
});
