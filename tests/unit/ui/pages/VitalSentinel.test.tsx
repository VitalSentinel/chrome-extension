import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UrlOverview } from '../../../../src/lib/app';
import { APP_URL, UTM } from '../../../../src/lib/config';
import type { PageKey } from '../../../../src/popup/nav';
import VitalSentinel from '../../../../src/popup/pages/VitalSentinel';
import {
  MONITORED,
  PAGE_URL,
  SIGNED_IN,
  mockSend,
  renderPage,
  tabContext,
  urlOverview,
} from '../fixtures';

vi.mock('../../../../src/lib/messages', () => ({ send: vi.fn() }));

afterEach(cleanup);

const monitoredCtx = (roles: Record<string, string> = SIGNED_IN.roles) =>
  tabContext({ auth: { ...SIGNED_IN, roles }, monitored: MONITORED });
const tile = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).parentElement!.parentElement as HTMLElement;
const fig = (t: HTMLElement, label: string) =>
  within(t).getByText(label).nextElementSibling!.textContent;
/** One form factor's LCP, INP and CLS values, read from each metric's card in the CrUX tile. */
const cruxRow = (label: 'Phone' | 'Desktop') =>
  ['Largest Contentful Paint', 'Interaction to Next Paint', 'Cumulative Layout Shift'].map(
    (name) =>
      within(within(tile('CrUX data')).getByText(name).parentElement!).getByText(label)
        .nextElementSibling!.textContent,
  );

let overview: UrlOverview;
let send: ReturnType<typeof mockSend>;
beforeEach(() => {
  overview = urlOverview();
  send = mockSend({
    'app:overview': () => ({ ok: true, data: overview }),
    'app:watch': () => ({ ok: true, data: { duplicate: false, watch: { id: 'w1' } } }),
    'auth:signOut': () => ({ signedIn: false, workspaces: [], roles: {} }),
  });
});

async function open(page: PageKey, ctx = monitoredCtx()) {
  const view = renderPage(VitalSentinel, { page, ctx });
  await screen.findByText(/Updated 10 min ago/);
  return view;
}

describe('while the account loads', () => {
  it('holds the summary in place instead of saying the site is not monitored', () => {
    renderPage(VitalSentinel, {
      page: 'vs-all',
      ctx: tabContext({ auth: { ...SIGNED_IN, pending: 'loading' } }),
    });
    expect(screen.getByRole('status', { name: 'Loading your VitalSentinel data' })).toBeTruthy();
    expect(screen.queryByText(/is not monitored/)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('says the account could not load, and tries again', async () => {
    const { props } = renderPage(VitalSentinel, {
      page: 'vs-all',
      ctx: tabContext({ auth: { ...SIGNED_IN, pending: 'failed' } }),
    });
    expect(screen.getByText(/Could not load your VitalSentinel account/)).toBeTruthy();
    expect(screen.queryByText(/is not monitored/)).toBeNull();
    let answer!: (v: unknown) => void;
    send.mockImplementation(((type: string) =>
      type === 'auth:state' ? new Promise((r) => (answer = r)) : Promise.resolve(null)) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      ((await screen.findByRole('button', { name: 'Trying…' })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(send).toHaveBeenCalledWith('auth:state', {});
    answer(SIGNED_IN);
    await waitFor(() => expect(props.reload).toHaveBeenCalled());
  });

  it('reloads even when trying again fails', async () => {
    const { props } = renderPage(VitalSentinel, {
      page: 'vs-all',
      ctx: tabContext({ auth: { ...SIGNED_IN, pending: 'failed' } }),
    });
    send.mockImplementation((() => Promise.reject(new Error('Worker gone'))) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(props.reload).toHaveBeenCalled());
  });

  it('shows a monitored site at once, even while the rest loads', async () => {
    await open(
      'vs-all',
      tabContext({ auth: { ...SIGNED_IN, pending: 'loading' }, monitored: MONITORED }),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Google Search Console' })).toBeTruthy();
  });
});

describe('signed out or not monitored', () => {
  it('offers sign-in and monitoring when signed out', () => {
    renderPage(VitalSentinel, { page: 'vs-all' });
    expect(screen.getByRole('button', { name: 'Sign in with VitalSentinel' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start monitoring free' })).toBeTruthy();
    expect(screen.getByText(/free for one domain/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('offers monitoring for an unmonitored site, and signing out', async () => {
    const { props } = renderPage(VitalSentinel, {
      page: 'vs-all',
      ctx: tabContext({ auth: SIGNED_IN }),
    });
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'example.com is not monitored in VitalSentinel',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add example.com ↗' })).toBeTruthy();
    expect(screen.queryByText('Everything VitalSentinel monitors')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(props.reload).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('auth:signOut', {});
  });
});

describe('a monitored site', () => {
  it('loads the 90-day overview and sums it up in four tiles', async () => {
    renderPage(VitalSentinel, { page: 'vs-all', ctx: monitoredCtx() });
    expect(screen.getByRole('status', { name: 'Loading your VitalSentinel data' })).toBeTruthy();
    expect(await screen.findByText('· Updated 10 min ago ·')).toBeTruthy();
    expect(screen.queryByText(/Acme/)).toBeNull();
    expect(screen.getByText('example.com/blog/core-web-vitals').getAttribute('title')).toBe(
      PAGE_URL,
    );
    expect(send).toHaveBeenCalledWith('app:overview', { domainId: 'dom1', url: PAGE_URL });
    expect(screen.getByText('Last 90 days')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Google Search Console',
      'Google index',
      'CrUX data',
      'Web Analytics',
    ]);
    for (const t of ['Google Search Console', 'Google index', 'CrUX data', 'Web Analytics'])
      expect(tile(t).querySelector('svg')).toBeTruthy(); // the module's sidebar icon
    const gsc = tile('Google Search Console');
    expect(fig(gsc, 'Clicks')).toBe('12k');
    expect(fig(gsc, 'Impressions')).toBe('530k');
    expect(fig(gsc, 'CTR')).toBe('2.3%');
    expect(fig(gsc, 'Average position')).toBe('7.4');
    const idx = tile('Google index');
    expect(fig(idx, 'Status')).toBe('Indexed');
    expect(fig(idx, 'Last crawled by Google')).toBe('Oct 20, 2026');
    expect(fig(idx, 'Last checked')).toBe('2 h ago');
    const crux = tile('CrUX data');
    for (const name of [
      'Largest Contentful Paint',
      'Interaction to Next Paint',
      'Cumulative Layout Shift',
    ])
      expect(within(crux).getByText(name)).toBeTruthy();
    expect(within(crux).queryByText(/p75/)).toBeNull();
    expect(cruxRow('Phone')).toEqual(['2.4 s', '–', '0.05']);
    expect(cruxRow('Desktop')).toEqual(['1.2 s', '–', '–']);
    const wa = tile('Web Analytics');
    expect(fig(wa, 'Page views')).toBe('8,210');
    expect(fig(wa, 'Bounce rate')).toBe('41.0%');
    // Older app versions send no visitors, visits or per-visit figures: those stay out.
    for (const label of ['Visitors', 'Visits', 'Views per visit', 'Time per visit', 'Entrances'])
      expect(within(wa).queryByText(label)).toBeNull();
    expect(screen.getByText('Full history and every module are in the app.')).toBeTruthy();
    expect(screen.queryByText(/alert/i)).toBeNull();
    expect(screen.queryByText(/alerts:/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in app ↗' }).getAttribute('href')).toBe(
      `${APP_URL}/dashboard/domains/dom1?${UTM}`,
    );
  });

  it('shows every Web Analytics figure the app sends', async () => {
    overview = urlOverview({
      web_analytics: {
        ...urlOverview().sections.web_analytics!,
        visitors: 3_100,
        visits: 4_400,
        views_per_visit: 1.86,
        time_per_visit_s: 172,
      },
    });
    await open('vs-all');
    const wa = tile('Web Analytics');
    expect(fig(wa, 'Page views')).toBe('8,210');
    expect(fig(wa, 'Visitors')).toBe('3,100');
    expect(fig(wa, 'Visits')).toBe('4,400');
    expect(fig(wa, 'Bounce rate')).toBe('41.0%');
    expect(fig(wa, 'Views per visit')).toBe('1.9');
    expect(fig(wa, 'Time per visit')).toBe('2 min 52 s');
  });

  it('shows a dash for Web Analytics figures the app could not measure', async () => {
    overview = urlOverview({
      web_analytics: {
        ...urlOverview().sections.web_analytics!,
        visitors: null,
        time_per_visit_s: null,
      },
    });
    await open('vs-all');
    expect(fig(tile('Web Analytics'), 'Visitors')).toBe('–');
    expect(fig(tile('Web Analytics'), 'Time per visit')).toBe('–');
  });

  it('sends each tile to the report page with the details, or to the app', async () => {
    overview = urlOverview({
      web_analytics: {
        ...urlOverview().sections.web_analytics!,
        deep_link: 'https://app.vitalsentinel.com/dashboard/domains/dom1/analytics',
      },
    });
    const { props } = await open('vs-all');
    for (const [label, page] of [
      ['Queries ›', 'content'],
      ['Indexability ›', 'indexability'],
      ['Performance ›', 'performance'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(props.go).toHaveBeenLastCalledWith(page);
    }
    expect(
      within(tile('Web Analytics'))
        .getByRole('link', { name: 'Open in app ↗' })
        .getAttribute('href'),
    ).toBe(`https://app.vitalsentinel.com/dashboard/domains/dom1/analytics?${UTM}`);
  });

  it('names an index verdict other than pass', async () => {
    overview = urlOverview({
      indexing: { ...urlOverview().sections.indexing!, verdict: 'FAIL' },
    });
    await open('vs-all');
    expect(fig(tile('Google index'), 'Status')).toBe('Not indexed');
  });

  it('refreshes past the cache', async () => {
    await open('vs-all');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith('app:overview', {
        domainId: 'dom1',
        url: PAGE_URL,
        refresh: true,
      }),
    );
  });

  it('asks to sign in again after a 401', async () => {
    mockSend({ 'app:overview': () => ({ ok: false, status: 401, error: 'unauthorized' }) });
    renderPage(VitalSentinel, { page: 'vs-all', ctx: monitoredCtx() });
    expect(await screen.findByText('Your session ended. Sign in again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Watch this page' })).toBeNull();
  });

  it('shows other API errors', async () => {
    mockSend({
      'app:overview': () => ({ ok: false, status: 500, error: 'Internal Server Error' }),
    });
    renderPage(VitalSentinel, { page: 'vs-all', ctx: monitoredCtx() });
    expect(
      await screen.findByText('VitalSentinel had a problem. Try again in a moment.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Internal Server Error/)).toBeNull();
  });

  it('says so when the worker does not answer', async () => {
    mockSend({
      'app:overview': () => {
        throw new Error('Worker gone');
      },
    });
    renderPage(VitalSentinel, { page: 'vs-all', ctx: monitoredCtx() });
    expect(await screen.findByText('Could not load data. Try again.')).toBeTruthy();
  });
});

describe('Watch this page', () => {
  it('adds the URL to page monitoring', async () => {
    await open('vs-all');
    const watch = screen.getByRole('button', { name: 'Watch this page' });
    expect(watch.getAttribute('title')).toBe('Add this URL to page monitoring');
    fireEvent.click(watch);
    expect(await screen.findByText('Watched')).toBeTruthy();
    expect(send).toHaveBeenCalledWith('app:watch', { domainId: 'dom1', url: PAGE_URL });
  });

  it('shows Adding… while the request runs', async () => {
    mockSend({
      'app:overview': () => ({ ok: true, data: overview }),
      'app:watch': () => new Promise(() => {}),
    });
    await open('vs-all');
    fireEvent.click(screen.getByRole('button', { name: 'Watch this page' }));
    expect(
      ((await screen.findByRole('button', { name: 'Adding…' })) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('explains the watched-page limit and other refusals', async () => {
    let error = 'limit_reached';
    mockSend({
      'app:overview': () => ({ ok: true, data: overview }),
      'app:watch': () => ({ ok: false, status: 409, error }),
    });
    await open('vs-all', monitoredCtx({ ws1: 'admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Watch this page' }));
    expect(await screen.findByText('Watched-page limit reached')).toBeTruthy();
    error = 'Domain is paused';
    fireEvent.click(screen.getByRole('button', { name: 'Watch this page' }));
    expect(await screen.findByText('The request did not go through. Try again.')).toBeTruthy();
  });

  it('is disabled for workspace members', async () => {
    await open('vs-all', monitoredCtx({ ws1: 'member' }));
    const watch = screen.getByRole('button', { name: 'Watch this page' }) as HTMLButtonElement;
    expect(watch.disabled).toBe(true);
    expect(watch.getAttribute('title')).toBe(
      'Only workspace owners and admins can change watched pages',
    );
  });

  it('shows Watched for a page already watched', async () => {
    overview = urlOverview({
      crawl: { status: 'ok', as_of: null, watch: { id: 'w1', state: 'active' } },
    });
    await open('vs-all');
    expect(screen.getByText('Watched')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Watch this page' })).toBeNull();
  });
});

describe('sections without data', () => {
  it('explains empty tiles and hides out-of-scope ones', async () => {
    const empty = { as_of: null };
    overview = urlOverview({
      search_console: { ...urlOverview().sections.search_console!, status: 'timeout', ...empty },
      indexing: { ...urlOverview().sections.indexing!, status: 'not_connected', ...empty },
      crux: { ...urlOverview().sections.crux!, status: 'no_data', ...empty },
      web_analytics: { ...urlOverview().sections.web_analytics!, status: 'not_in_scope' },
    });
    await open('vs-all');
    expect(within(tile('Google Search Console')).getByText('The app took too long.')).toBeTruthy();
    expect(within(tile('Google index')).getByText('Not set up for this domain yet.')).toBeTruthy();
    expect(within(tile('CrUX data')).getByText('No data yet.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Web Analytics' })).toBeNull();
  });

  it('tries a timed-out tile again past the cache, with skeletons in place of the tiles', async () => {
    overview = urlOverview({
      search_console: { ...urlOverview().sections.search_console!, status: 'timeout', as_of: null },
    });
    await open('vs-all');
    let answer!: (v: unknown) => void;
    send.mockImplementation(((type: string, req: { refresh?: boolean }) =>
      type !== 'app:overview'
        ? Promise.resolve(null)
        : req.refresh
          ? new Promise((r) => (answer = r))
          : Promise.resolve({ ok: true, data: urlOverview() })) as never);
    const before = send.mock.calls.length;
    fireEvent.click(
      within(tile('Google Search Console')).getByRole('button', { name: 'Try again' }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith('app:overview', {
        domainId: 'dom1',
        url: PAGE_URL,
        refresh: true,
      }),
    );
    expect(screen.getByRole('status', { name: 'Loading your VitalSentinel data' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Google Search Console' })).toBeNull();
    expect(screen.queryByText(/Updated/)).toBeNull();
    answer({ ok: true, data: urlOverview() });
    await waitFor(() => expect(fig(tile('Google Search Console'), 'Clicks')).toBe('12k'));
    expect(screen.getByText(/Updated 10 min ago/)).toBeTruthy();
    // Past the cache once, then the plain read of what that refresh cached.
    const after = send.mock.calls.slice(before).filter(([t]) => t === 'app:overview');
    expect(after.map(([, req]) => (req as { refresh?: boolean }).refresh ?? false)).toEqual([
      true,
      false,
    ]);
  });

  it('says why a refresh failed and keeps the data it has', async () => {
    await open('vs-all');
    send.mockImplementation(((type: string, req: { refresh?: boolean }) =>
      type !== 'app:overview'
        ? Promise.resolve(null)
        : Promise.resolve(
            req.refresh ? { ok: false, status: 0, error: 'network' } : { ok: true, data: overview },
          )) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Could not reach VitalSentinel. Try again.')).toBeTruthy();
    expect(await screen.findByText(/Updated 10 min ago/)).toBeTruthy();
  });

  it('says why a refresh threw', async () => {
    await open('vs-all');
    send.mockImplementation(((type: string, req: { refresh?: boolean }) =>
      type === 'app:overview' && req.refresh
        ? Promise.reject(new Error('Worker gone'))
        : Promise.resolve({ ok: true, data: overview })) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Could not load data. Try again.')).toBeTruthy();
  });

  it('skips sections the overview leaves out and names missing access', async () => {
    overview = urlOverview({}, { missing_scopes: ['read:analytics'] });
    overview.sections = { crawl: overview.sections.crawl };
    await open('vs-all');
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByText(/Some data needs more access: read:analytics/)).toBeTruthy();
  });
});
