import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Section } from '../../../src/lib/app';
import {
  appError,
  AppSection,
  CruxHistory,
  cruxWeeks,
  appView,
  GoogleIndex,
  IndexedInGoogle,
  indexedLabel,
  SearchConsole,
  SectionSkeleton,
  useAppOverview,
  WatchButton,
} from '../../../src/popup/appData';
import { appOverview } from './appOverview';
import { MONITORED, PAGE_URL, SIGNED_IN, mockSend, tabContext } from './fixtures';

vi.mock('../../../src/lib/messages', () => ({ send: vi.fn() }));

afterEach(cleanup);

const monitored = tabContext({ auth: SIGNED_IN, monitored: MONITORED });
const base = appOverview();
const app = (o: ReturnType<typeof appOverview> | null = base, loading = false) => ({ o, loading });

describe('useAppOverview', () => {
  function Probe({ reload }: { reload?: number }) {
    const r = useAppOverview(monitored, PAGE_URL, reload);
    return <span>{r.data?.ok ? 'loaded' : 'waiting'}</span>;
  }

  it('asks the worker for the page, and again for a new reload value, never past the cache', async () => {
    const send = mockSend({ 'app:overview': () => ({ ok: true, data: base }) });
    const { rerender } = render(<Probe />);
    expect(await screen.findByText('loaded')).toBeTruthy();
    expect(send).toHaveBeenCalledWith('app:overview', { domainId: 'dom1', url: PAGE_URL });
    rerender(<Probe reload={1} />);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls.every(([, req]) => !('refresh' in (req as object)))).toBe(true);
  });

  it('asks nothing for a site that is not monitored', async () => {
    const send = mockSend();
    function Plain() {
      const r = useAppOverview(tabContext(), PAGE_URL);
      return <span>{r.loading ? 'loading' : String(r.data)}</span>;
    }
    render(<Plain />);
    expect(await screen.findByText('null')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('AppSection', () => {
  const show = (s: Section | undefined) =>
    render(
      <AppSection title="Thing" s={s}>
        <p>content</p>
      </AppSection>,
    );

  it('shows the content with a link into the app, marking domain-wide data', () => {
    show({ status: 'ok', as_of: null, scope: 'domain', deep_link: '/dashboard/x' });
    expect(screen.getByText('content')).toBeTruthy();
    expect(screen.getByText('Whole domain')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in app ↗' }).getAttribute('href')).toContain(
      '/dashboard/x',
    );
  });

  it('dates data without a link and leaves out page-level scope', () => {
    show({ status: 'ok', as_of: new Date(Date.now() - 2 * 3600_000).toISOString(), scope: 'url' });
    expect(screen.getByText(/^As of /)).toBeTruthy();
    expect(screen.queryByText('Whole domain')).toBeNull();
  });

  it.each([
    [{ status: 'not_connected', as_of: null }, 'Not set up for this domain yet.'],
    [{ status: 'timeout', as_of: null }, 'Took too long – try again.'],
    [
      { status: 'no_data', as_of: null, reason: 'No visits in the window' },
      'No visits in the window.',
    ],
    [
      { status: 'no_data', as_of: null, reason: 'this URL has not been inspected by Google yet' },
      'This URL has not been inspected by Google yet.',
    ],
    [{ status: 'no_data', as_of: null, reason: 'no_rows' }, 'No data yet.'],
  ] as [Section, string][])('explains a section without data', (s, text) => {
    show(s);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('shows nothing for a section the key cannot read, or one not sent', () => {
    const { container } = show({ status: 'not_in_scope', as_of: null });
    expect(container.textContent).toBe('');
    cleanup();
    expect(show(undefined).container.textContent).toBe('');
  });
});

describe('the sections', () => {
  it('shows Search Console totals and top queries', () => {
    render(<SearchConsole app={app(base)} />);
    expect(screen.getByText('12k')).toBeTruthy();
    expect(screen.getByText('530k')).toBeTruthy();
    expect(screen.getByText('2.3%')).toBeTruthy();
    expect(screen.getByText('7.4')).toBeTruthy();
    expect(screen.getByText('core web vitals & seo')).toBeTruthy();
    expect(screen.getByText('3.1')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy(); // a query without a position
  });

  it('shows dashes and no table when Search Console has no numbers', () => {
    const gsc = {
      ...base.sections.search_console!,
      clicks: null,
      impressions: null,
      ctr: null,
      average_position: null,
      top_queries: [],
    };
    render(<SearchConsole app={app(appOverview({ search_console: gsc }))} />);
    expect(screen.getAllByText('–')).toHaveLength(4);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('labels the index verdict', () => {
    const idx = base.sections.indexing!;
    expect(indexedLabel(base)).toEqual(['Indexed', 'good']);
    expect(indexedLabel(appOverview({ indexing: { ...idx, verdict: 'FAIL' } }))).toEqual([
      'Not indexed',
      'bad',
    ]);
    expect(
      indexedLabel(appOverview({ indexing: { ...idx, verdict: 'NEUTRAL', coverage_state: null } })),
    ).toEqual(['–', undefined]);
    expect(indexedLabel(appOverview({ indexing: { ...idx, status: 'no_data' } }))).toEqual([
      '–',
      undefined,
    ]);
  });

  it("shows Google's index status, last crawl and a differing canonical", () => {
    render(<GoogleIndex app={app(base)} />);
    expect(screen.getByText('Submitted and indexed')).toBeTruthy();
    expect(screen.getByText(/· Mobile$/)).toBeTruthy();
    expect(screen.getByText('https://www.example.com/blog/cwv')).toBeTruthy();
  });

  it('shows a matching canonical and no crawl yet', () => {
    const idx = {
      ...base.sections.indexing!,
      coverage_state: null,
      canonical_differs: false,
      last_crawl_time: null,
    };
    render(<GoogleIndex app={app(appOverview({ indexing: idx }))} />);
    expect(screen.getByText('Indexed')).toBeTruthy();
    expect(screen.getByText('Same as declared')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
  });
});

describe('CrUX', () => {
  it('lists phone weeks oldest first', () => {
    expect(cruxWeeks(base.sections.crux, 'LCP').map((w) => w.p75)).toEqual([2600, 2500, 2400]);
    expect(cruxWeeks(undefined, 'LCP')).toEqual([]);
  });

  it('charts the weeks per metric and says when there are too few', () => {
    render(<CruxHistory app={app(base)} />);
    const crux = screen.getByRole('heading', { level: 2 }).closest('section') as HTMLElement;
    expect(crux.querySelector('svg')).toBeTruthy();
    fireEvent.click(within(crux).getByRole('button', { name: 'CLS' }));
    expect(within(crux).getByText(/^Week of /)).toBeTruthy();
    expect(within(crux).getByText('0.05')).toBeTruthy();
    expect(within(crux).getByText('· The trend appears from the second week')).toBeTruthy();
    fireEvent.click(within(crux).getByRole('button', { name: 'TTFB' }));
    expect(within(crux).getByText('No TTFB data for phones.')).toBeTruthy();
  });

  it('prefers the weekly history over the newest records', () => {
    const crux = {
      ...base.sections.crux!,
      history: [
        { form_factor: 'PHONE', metric: 'TTFB', collection_date: '2026-08-01', p75: 900 },
        { form_factor: 'PHONE', metric: 'TTFB', collection_date: '2026-07-01', p75: 700 },
        { form_factor: 'DESKTOP', metric: 'TTFB', collection_date: '2026-07-01', p75: 100 },
      ],
    };
    expect(cruxWeeks(crux, 'TTFB').map((w) => w.p75)).toEqual([700, 900]);
    expect(cruxWeeks(crux, 'LCP')).toEqual([]);
    render(<CruxHistory app={app(appOverview({ crux }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'TTFB' }));
    expect(
      screen.getByRole('heading', { level: 2 }).closest('section')!.querySelector('svg'),
    ).toBeTruthy();
  });
});

describe('WatchButton', () => {
  const button = () => screen.getByRole('button', { name: 'Watch this page' });

  it('shows a page already watched', () => {
    const o = appOverview({
      crawl: { status: 'ok', as_of: null, watch: { id: 'w', state: 'on' } },
    });
    render(<WatchButton o={o} ctx={monitored} />);
    expect(screen.getByText('Watched')).toBeTruthy();
  });

  it('watches the page for an owner', async () => {
    const send = mockSend({
      'app:watch': () => ({ ok: true, data: { duplicate: false, watch: { id: 'w1' } } }),
      'app:unwatch': () => ({ ok: true, data: null }),
    });
    render(<WatchButton o={base} ctx={monitored} />);
    fireEvent.click(button());
    expect(await screen.findByText('Watched')).toBeTruthy();
    expect(send).toHaveBeenCalledWith('app:watch', { domainId: 'dom1', url: monitored.url });
    expect(send).toHaveBeenCalledWith('usage:count', { event: 'watch' });

    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(await screen.findByRole('button', { name: 'Watch this page' })).toBeTruthy();
    expect(send).toHaveBeenCalledWith('app:unwatch', { domainId: 'dom1', watchId: 'w1' });
    expect(screen.queryByText('Watched')).toBeNull();
  });

  it('says why stopping failed and stays watched', async () => {
    mockSend({ 'app:unwatch': () => ({ ok: false, status: 403, error: 'forbidden' }) });
    const o = {
      ...base,
      sections: {
        ...base.sections,
        crawl: { status: 'ok' as const, as_of: null, watch: { id: 'w', state: 'on' } },
      },
    };
    render(<WatchButton o={o} ctx={monitored} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(
      await screen.findByText('Only workspace owners and admins can change watched pages'),
    ).toBeTruthy();
    expect(screen.getByText('Watched')).toBeTruthy();
  });

  it('counts a watch that is already gone as stopped', async () => {
    mockSend({ 'app:unwatch': () => ({ ok: false, status: 404, error: 'HTTP 404' }) });
    const o = {
      ...base,
      sections: {
        ...base.sections,
        crawl: { status: 'ok' as const, as_of: null, watch: { id: 'w', state: 'on' } },
      },
    };
    render(<WatchButton o={o} ctx={monitored} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(await screen.findByRole('button', { name: 'Watch this page' })).toBeTruthy();
    expect(screen.queryByText('Watched')).toBeNull();
    expect(screen.queryByText(/404/)).toBeNull();
  });

  it('follows a newer answer from the app', () => {
    const watched = {
      ...base,
      generated_at: '2026-10-25T12:00:00Z',
      sections: {
        ...base.sections,
        crawl: { status: 'ok' as const, as_of: null, watch: { id: 'w', state: 'on' } },
      },
    };
    const { rerender } = render(<WatchButton o={base} ctx={monitored} />);
    expect(screen.getByRole('button', { name: 'Watch this page' })).toBeTruthy();
    rerender(<WatchButton o={watched} ctx={monitored} />);
    expect(screen.getByRole('button', { name: 'Stop watching' })).toBeTruthy();
    rerender(<WatchButton o={base} ctx={monitored} />);
    expect(screen.getByRole('button', { name: 'Watch this page' })).toBeTruthy();
  });

  it('is disabled for a member', () => {
    const ctx = tabContext({
      auth: { ...SIGNED_IN, roles: { ws1: 'member' } },
      monitored: MONITORED,
    });
    render(<WatchButton o={base} ctx={ctx} />);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(button().getAttribute('title')).toBe(
      'Only workspace owners and admins can change watched pages',
    );
  });

  it.each([
    [
      { ok: false, status: 403, error: 'forbidden' },
      'Only workspace owners and admins can change watched pages',
    ],
    [{ ok: false, status: 409, error: 'limit_reached' }, 'Watched-page limit reached'],
    [
      { ok: false, status: 500, error: 'server' },
      'VitalSentinel had a problem. Try again in a moment.',
    ],
    [{ ok: false, status: 0, error: 'network' }, 'Could not reach VitalSentinel. Try again.'],
  ] as [{ ok: false; status: number; error: string }, string][])(
    'explains a refused watch',
    async (res, text) => {
      mockSend({ 'app:watch': () => res });
      render(<WatchButton o={base} ctx={monitored} />);
      fireEvent.click(button());
      expect(await screen.findByText(text, { selector: 'span' })).toBeTruthy();
      expect(button()).toBeTruthy();
    },
  );

  it('shows why the request failed', async () => {
    mockSend({
      'app:watch': () => {
        throw new Error('Worker gone');
      },
    });
    render(<WatchButton o={base} ctx={monitored} />);
    fireEvent.click(button());
    expect(await screen.findByText('The request did not go through. Try again.')).toBeTruthy();
  });
});

describe('while the app answers', () => {
  it.each([
    ['Google Search Console · Last 90 days', () => <SearchConsole app={app(null, true)} />],
    ['Google index', () => <GoogleIndex app={app(null, true)} />],
    ['CrUX data · Last 90 days · Phone', () => <CruxHistory app={app(null, true)} />],
  ])('holds the space of %s', (title, view) => {
    render(view());
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByRole('status', { name: `Loading ${title}` }).className).toContain(
      'skeleton',
    );
  });

  it('shows nothing once the app answered without data', () => {
    for (const C of [SearchConsole, GoogleIndex, CruxHistory]) {
      const { container } = render(<C app={app(null)} />);
      expect(container.textContent).toBe('');
      cleanup();
    }
  });

  it('sizes the skeleton', () => {
    render(<SectionSkeleton title="Thing" height={120} />);
    expect(screen.getByRole('status', { name: 'Loading Thing' }).style.height).toBe('120px');
  });

  it('reads the view from the async state', () => {
    expect(appView({ data: { ok: true, data: base }, error: null, loading: false })).toEqual({
      o: base,
      loading: false,
    });
    expect(
      appView({ data: { ok: false, status: 500, error: 'x' }, error: null, loading: false }),
    ).toEqual({ o: null, loading: false });
    expect(appView({ data: undefined, error: null, loading: true })).toEqual({
      o: null,
      loading: true,
    });
  });
});

describe('IndexedInGoogle', () => {
  const idx = base.sections.indexing!;

  it('says the page is in the index, with the last crawl', () => {
    const { container } = render(<IndexedInGoogle app={app()} />);
    expect(screen.getByText('In Google’s index').className).toContain('text-good-text');
    expect(container.textContent).toContain('Last crawled');
    expect(container.textContent).toContain('Google Search Console via VitalSentinel');
  });

  it('says why a page is not in the index', () => {
    const o = appOverview({
      indexing: {
        ...idx,
        verdict: 'FAIL',
        coverage_state: 'Crawled – currently not indexed',
        last_crawl_time: null,
      },
    });
    const { container } = render(<IndexedInGoogle app={app(o)} />);
    expect(screen.getByText('Not in Google’s index').className).toContain('text-poor-text');
    expect(container.textContent).toContain(' – Crawled – currently not indexed');
    expect(container.textContent).not.toContain('last crawled');
  });

  it('names another verdict as the app states it', () => {
    const o = appOverview({
      indexing: { ...idx, verdict: 'NEUTRAL', coverage_state: 'Excluded by noindex' },
    });
    render(<IndexedInGoogle app={app(o)} />);
    expect(screen.getByText('Excluded by noindex').className).toContain('text-ink');
  });

  it('holds a line while loading, and nothing without index data', () => {
    render(<IndexedInGoogle app={app(null, true)} />);
    expect(screen.getByRole('status', { name: 'Loading the Google index status' })).toBeTruthy();
    cleanup();
    expect(render(<IndexedInGoogle app={app(null)} />).container.textContent).toBe('');
    cleanup();
    const o = appOverview({ indexing: { ...idx, status: 'no_data' } });
    expect(render(<IndexedInGoogle app={app(o)} />).container.textContent).toBe('');
  });

  it('shows nothing when the app knows neither a verdict nor a coverage state', () => {
    const o = appOverview({ indexing: { ...idx, verdict: null, coverage_state: null } });
    expect(render(<IndexedInGoogle app={app(o)} />).container.textContent).toBe('');
  });
});

describe('appError', () => {
  it.each([
    [0, 'offline', 'Offline mode is on. Turn it off in Settings to load this.'],
    [401, 'signed_out', 'Your session ended. Sign in again.'],
    [401, 'HTTP 401', 'Your session ended. Sign in again.'],
    [0, 'network', 'Could not reach VitalSentinel. Try again.'],
    [502, 'HTTP 502', 'VitalSentinel had a problem. Try again in a moment.'],
    [404, 'not_found', 'VitalSentinel could not find this. Refresh and try again.'],
    [422, 'invalid_url', 'The request did not go through. Try again.'],
  ])('%i %s → %s', (status, error, text) => {
    expect(appError(status, error)).toBe(text);
  });
});
