import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TabContext } from '../../../src/lib/messages';
import type { Count } from '../../../src/popup/badges';
import type { PageKey } from '../../../src/popup/nav';
import { Sidebar } from '../../../src/popup/Sidebar';
import { MONITORED, PAGE_URL, SIGNED_IN, mockSend, tabContext } from './fixtures';

vi.mock('../../../src/lib/messages', () => ({ send: vi.fn() }));

let send: ReturnType<typeof mockSend>;
beforeEach(() => {
  fakeBrowser.reset();
  send = mockSend({ 'js:set': (r) => r.setting });
});
afterEach(cleanup);

function renderSidebar(
  page: PageKey,
  ctx: Partial<TabContext> = {},
  counts: Partial<Record<PageKey, Count>> = {},
) {
  const go = vi.fn();
  const reload = vi.fn();
  const view = render(
    <Sidebar page={page} go={go} counts={counts} ctx={tabContext(ctx)} reload={reload} />,
  );
  return { ...view, go, reload };
}

const nav = () => screen.getByRole('navigation', { name: 'Report' });
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('accordion', () => {
  it('lists only the pages of the open group', () => {
    renderSidebar('schema');
    for (const p of ['Content', 'Structured data', 'Social tags', 'Images'])
      expect(button(p)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Indexability' })).toBeNull();
    expect(button(/On-page/).getAttribute('aria-expanded')).toBe('true');
    expect(button(/Crawl and index/).getAttribute('aria-expanded')).toBe('false');
    expect(button('Structured data').getAttribute('aria-current')).toBe('page');
  });

  it('switching groups opens the new one and collapses the old one', () => {
    const { go, rerender } = renderSidebar('content');
    fireEvent.click(button(/Crawl and index/));
    expect(go).toHaveBeenCalledWith('indexability');

    rerender(
      <Sidebar page="indexability" go={go} counts={{}} ctx={tabContext()} reload={vi.fn()} />,
    );
    for (const p of ['Indexability', 'Crawlers', 'Links']) expect(button(p)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Content' })).toBeNull();
  });

  it('single-page groups have no expanded state and mark the current page', () => {
    renderSidebar('overview');
    const overview = button('Overview');
    expect(overview.hasAttribute('aria-expanded')).toBe(false);
    expect(overview.getAttribute('aria-current')).toBe('page');
    expect(button(/Performance/).hasAttribute('aria-current')).toBe(false);
  });

  it('clicking a page in the open group goes there', () => {
    const { go } = renderSidebar('content');
    fireEvent.click(button('Images'));
    expect(go).toHaveBeenCalledWith('images');
  });
});

describe('badges', () => {
  const counts = {
    content: { n: 2, bad: false },
    images: { n: 3, bad: true },
    links: { n: 0, bad: false },
    performance: { n: 1, bad: false },
  };

  it('a collapsed group shows the sum of its pages', () => {
    renderSidebar('overview', {}, counts);
    expect(button(/On-page/).textContent).toBe('On-page5');
    expect(button(/Crawl and index/).textContent).toBe('Crawl and index');
    expect(button(/Performance/).textContent).toBe('Performance1');
  });

  it('names the level of each count, not only its colour', () => {
    renderSidebar('content', {}, counts);
    expect(screen.getByRole('img', { name: '2 warnings' }).textContent).toBe('2');
    expect(screen.getByRole('img', { name: '3 issues, including errors' })).toBeTruthy();
    cleanup();
    renderSidebar('overview', {}, { content: { n: 1, bad: false }, links: { n: 1, bad: true } });
    expect(screen.getByRole('img', { name: '1 warning' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '1 error' })).toBeTruthy();
  });

  it('an open group shows the count per page instead', () => {
    renderSidebar('content', {}, counts);
    expect(button(/On-page/).textContent).toBe('On-page');
    expect(button(/^Content/).textContent).toBe('Content2');
    expect(button(/^Images/).textContent).toBe('Images3');
    expect(button(/^Social tags/).textContent).toBe('Social tags');
  });
});

describe('VitalSentinel entry', () => {
  it('shows a lock and a Sign in button that starts sign-in when signed out', async () => {
    send = mockSend({ 'auth:signIn': () => ({ ok: true, data: SIGNED_IN }) });
    const { go, reload } = renderSidebar('overview');
    expect(screen.getByRole('img', { name: 'Sign-in required' })).toBeTruthy();
    fireEvent.click(button('Sign in'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith('auth:signIn', {});
    expect(go).not.toHaveBeenCalled();
  });

  it('shows why sign-in failed', async () => {
    send = mockSend({
      'auth:signIn': () => ({ ok: false, status: 0, error: 'Sign-in was cancelled' }),
    });
    const { reload } = renderSidebar('overview');
    fireEvent.click(button('Sign in'));
    expect((await screen.findByRole('alert')).textContent).toBe('Sign-in was cancelled');
    expect(reload).not.toHaveBeenCalled();
  });

  it('marks the entry as current for a signed-out visitor on the VitalSentinel page', () => {
    renderSidebar('vs-all');
    expect(button(/VitalSentinel/).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('shows who is signed in, without a lock', () => {
    renderSidebar('overview', { auth: SIGNED_IN, monitored: MONITORED });
    expect(screen.queryByRole('img', { name: 'Sign-in required' })).toBeNull();
    expect(screen.queryByText(/Acme/)).toBeNull();
    expect(screen.getByText('VS')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('opens the one VitalSentinel page for a monitored site, with no sub-pages', () => {
    const { go } = renderSidebar('vs-all', { auth: SIGNED_IN, monitored: MONITORED });
    expect(button(/VitalSentinel/).getAttribute('aria-current')).toBe('page');
    for (const p of ['All data', 'Search', 'Traffic', 'Experience', /Uptime/])
      expect(screen.queryByRole('button', { name: p })).toBeNull();
    fireEvent.click(button(/VitalSentinel/));
    expect(go).toHaveBeenCalledWith('vs-all');
  });

  it('falls back to a generic label without workspaces', () => {
    renderSidebar('overview', { auth: { signedIn: true, workspaces: [], roles: {} } });
    expect(screen.getByText('Signed in')).toBeTruthy();
    expect(screen.getAllByText('VitalSentinel').length).toBeGreaterThan(1);
    expect(screen.getByText('VS')).toBeTruthy();
  });
});

describe('tools', () => {
  it('the JavaScript switch blocks JS for the host, then reloads the context', async () => {
    const { reload } = renderSidebar('overview');
    const sw = screen.getByRole('switch', { name: 'JavaScript on this site' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith('js:set', {
      tabId: 7,
      url: PAGE_URL,
      setting: 'block',
      scope: 'host',
    });
  });

  it('the JavaScript switch allows JS again when it is blocked', async () => {
    renderSidebar('overview', { js: 'block' });
    fireEvent.click(screen.getByRole('switch', { name: 'JavaScript on this site' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('js:set', expect.objectContaining({ setting: 'allow' })),
    );
  });

  it('the JavaScript switch is disabled off the web', () => {
    renderSidebar('overview', { url: 'chrome://extensions/' });
    expect(
      (screen.getByRole('switch', { name: 'JavaScript on this site' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('Settings opens the options page', () => {
    const open = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    renderSidebar('overview');
    fireEvent.click(button('Settings'));
    expect(open).toHaveBeenCalledOnce();
  });

  it('credits Ahrefs for Domain Rating', () => {
    renderSidebar('overview');
    expect(screen.getByRole('link', { name: 'Ahrefs' }).getAttribute('href')).toBe(
      'https://ahrefs.com/',
    );
    expect(nav()).toBeTruthy();
  });
});
