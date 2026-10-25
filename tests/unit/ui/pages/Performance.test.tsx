import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Performance from '../../../../src/popup/pages/Performance';
import { resource } from '../../fixtures';
import {
  MONITORED,
  PAGE_URL,
  SIGNED_IN,
  mockSend,
  pageSnap,
  renderPage,
  setupData,
  tabContext,
  tabVitals,
} from '../fixtures';
import { appOverview } from '../appOverview';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);
vi.mock('../../../../src/lib/messages', () => ({ send: vi.fn() }));

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
});
afterEach(cleanup);

const value = (label: string) => screen.getByText(label).nextElementSibling!.textContent;
const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const stat = (s: HTMLElement, label: string) =>
  within(s).getByText(label).nextElementSibling!.textContent;
const overlaySwitch = () =>
  screen.getByRole('switch', { name: 'Outline the LCP element and layout shifts on the page' });

describe('overlay', () => {
  it('outlines the LCP element and shifts on the page, and removes them again', async () => {
    renderPage(Performance);
    fireEvent.click(overlaySwitch());
    expect(
      await screen.findByText('LCP element outlined in purple · 2 shifted elements in red'),
    ).toBeTruthy();
    expect(data.overlay).toHaveBeenCalledWith(7, true);

    fireEvent.click(overlaySwitch());
    await waitFor(() => expect(data.overlay).toHaveBeenLastCalledWith(7, false));
    expect(screen.queryByText(/outlined in purple ·/)).toBeNull();
    expect(screen.getByText(/^Outlines the LCP element/)).toBeTruthy();
  });

  it('says when the LCP element is not on screen', async () => {
    data.overlay.mockResolvedValue({ lcp: false, shifts: 1 });
    renderPage(Performance);
    fireEvent.click(overlaySwitch());
    expect(
      await screen.findByText('LCP element not found on screen · 1 shifted element in red'),
    ).toBeTruthy();
    data.overlay.mockResolvedValue({ lcp: true, shifts: 0 });
    fireEvent.click(overlaySwitch());
    fireEvent.click(overlaySwitch());
    expect(
      await screen.findByText('LCP element outlined in purple · No layout shifts to show'),
    ).toBeTruthy();
  });

  // It used to stay switched on with nothing drawn when the page could not be reached.
  it('switches back off and says so when the page cannot be drawn on', async () => {
    data.overlay.mockRejectedValue(new Error('Cannot access contents of the page'));
    renderPage(Performance);
    fireEvent.click(overlaySwitch());
    expect(
      await screen.findByText('Could not draw on this page. Reload it and try again.'),
    ).toBeTruthy();
    expect(overlaySwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('shows the switch on when the overlay is still on the page', async () => {
    data.overlayShown.mockResolvedValue(true);
    renderPage(Performance);
    await waitFor(() => expect(overlaySwitch().getAttribute('aria-checked')).toBe('true'));
    expect(data.overlayShown).toHaveBeenCalledWith(7);
  });
});

describe('CrUX data', () => {
  it('orders the device tiles and offers CrUX free instead of calling Google', () => {
    renderPage(Performance);
    const device = section('Measured on this device');
    const rows = [...device.querySelectorAll('[style*="grid-template-columns"]')].map((row) =>
      [...row.children].map((tile) => tile.firstElementChild!.firstElementChild!.textContent),
    );
    expect(rows).toEqual([
      ['TTFB', 'LCP', 'FCP'],
      ['CLS', 'INP'],
    ]);
    const crux = section(/^CrUX data/);
    expect(within(crux).getByText(/^Free CrUX data for /)).toBeTruthy();
    expect(within(crux).getByRole('link', { name: 'Get CrUX free' })).toBeTruthy();
  });

  it('shows the CrUX history instead of the offer for a monitored site', async () => {
    mockSend({ 'app:overview': () => ({ ok: true, data: appOverview() }) });
    renderPage(Performance, { ctx: tabContext({ auth: SIGNED_IN, monitored: MONITORED }) });
    expect(
      screen.getByRole('status', { name: 'Loading CrUX data · Last 90 days · Phone' }),
    ).toBeTruthy();
    await screen.findByRole('button', { name: 'LCP' });
    const crux = screen
      .getByRole('heading', { level: 2, name: 'CrUX data · Last 90 days · Phone' })
      .closest('section') as HTMLElement;
    expect(within(crux).getByRole('button', { name: 'TTFB' })).toBeTruthy();
    expect(screen.queryByText(/^Free CrUX data for /)).toBeNull();
  });

  it('shows neither offer nor history for a signed-in site that is not monitored', () => {
    renderPage(Performance, { ctx: tabContext({ auth: SIGNED_IN }) });
    expect(screen.queryByText(/^Free CrUX data for /)).toBeNull();
    expect(screen.queryByText(/^CrUX data/)).toBeNull();
  });
});

describe('this load', () => {
  it('shows the LCP element, the load timings, page weight and the promo', () => {
    renderPage(Performance);
    expect(value('LCP element')).toBe('img.heroPainted at 1.8 s');
    expect(value('Largest shift')).toBe('No layout shifts');
    expect(value('Page load')).toBe('DOM ready 1.2 s · Fully loaded 2.1 s');
    expect(screen.getByText('180 ms')).toBeTruthy(); // TTFB tile, from navigation timing
    expect(screen.getByText('900 ms')).toBeTruthy();
    const weight = section('Page weight');
    expect(stat(weight, 'Requests')).toBe('1');
    expect(stat(weight, 'Transferred')).toBe('57 KB');
    expect(stat(weight, 'JavaScript')).toBe('39 KB');
    expect(stat(weight, 'Images')).toBe('0 B'); // none on the page
    expect(stat(weight, 'Third parties')).toBe('0');
    expect(
      screen.getByRole('link', { name: 'Run on PageSpeed Insights ↗' }).getAttribute('href'),
    ).toBe(`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(PAGE_URL)}`);
  });

  it('shows dashes for what was not measured', () => {
    renderPage(Performance, {
      ctx: tabContext({ vitals: null, auth: SIGNED_IN, monitored: MONITORED }),
      snap: pageSnap({
        timing: { ttfb: 0, fcp: 0, domContentLoaded: 0, load: 0, transferSize: 0 },
        resources: [],
      }),
    });
    expect(value('LCP element')).toBe('–');
    expect(value('Page load')).toBe('DOM ready – · Fully loaded –');
    expect(screen.getByText('Interact with the page first')).toBeTruthy();
    expect(screen.getAllByText('Not measured yet')).toHaveLength(4);
    expect(screen.queryByRole('link', { name: 'Start monitoring' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Layout shifts/ })).toBeNull();
  });

  it('lists the layout shifts, largest first, with selectors that break cleanly', () => {
    renderPage(Performance, {
      ctx: tabContext({
        vitals: tabVitals({
          shifts: [
            { value: 0.01, selectors: [] },
            { value: 0.123, selectors: ['div.ad', 'img.banner'] },
          ],
        }),
      }),
    });
    expect(value('Largest shift')).toBe('div.ad, img.banner0.123 of CLS 0.02');
    const shifts = section(/^Layout shifts · 2/);
    const rows = within(shifts).getAllByText(/^0\.\d{3}$/);
    expect(rows.map((r) => r.textContent)).toEqual(['0.123', '0.010']);
    expect(within(shifts).getByText('removed from the page')).toBeTruthy();
    expect(
      within(shifts)
        .getAllByText(/div\.ad/)[0]
        .querySelectorAll('wbr').length,
    ).toBe(4);
  });
});

describe('resources', () => {
  it('says when nothing needs fixing', () => {
    renderPage(Performance);
    expect(screen.getByText('No render-blocking or uncompressed resources found.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Resources · 1 requests' })).toBeTruthy();
  });

  it('lists flagged files in one table and sums third-party weight', () => {
    const snap = pageSnap({
      resources: [
        resource('https://www.example.com/assets/site.css?v=3', {
          type: 'link',
          renderBlocking: true,
          transferSize: 0,
          encodedSize: 22_000,
          decodedSize: 90_000,
          duration: 340,
        }),
        resource('https://www.example.com/assets/legacy.js', {
          transferSize: 50_000,
          encodedSize: 50_000,
          decodedSize: 50_000,
        }),
        resource('https://cdn.tracker.io/both.js', {
          renderBlocking: true,
          transferSize: 200_000,
          encodedSize: 200_000,
          decodedSize: 200_000,
        }),
        resource('https://cdn.tracker.io/pixel.gif', { type: 'img', transferSize: 2048 }),
        resource('https://a.io/x.js'),
        resource('https://b.io/x.js', { transferSize: 1000 }),
        resource('https://c.io/x.js', { transferSize: 3000 }),
        resource('https://d.io/x.js', { transferSize: 500 }),
      ],
    });
    renderPage(Performance, { snap });
    expect(screen.getByText('2 render-blocking resources').className).toContain('text-poor-text');
    expect(screen.getByText('2 text files served uncompressed')).toBeTruthy();
    expect(screen.getByText('Third parties are 74% of the bytes')).toBeTruthy();
    const file = screen.getByText('/assets/site.css');
    expect(file.getAttribute('title')).toBe('/assets/site.css');
    expect(file.parentElement!.parentElement!.textContent).toBe(
      '/assets/site.cssRender-blocking21 KBfirst-party',
    );
    expect(screen.getByText('/assets/legacy.js').parentElement!.parentElement!.textContent).toBe(
      '/assets/legacy.jsNot compressed49 KBfirst-party',
    );
    expect(
      screen.getByText('cdn.tracker.io/both.js').parentElement!.parentElement!.textContent,
    ).toBe('cdn.tracker.io/both.jsBlocking, not compressed195 KBthird-party');
    const third = screen
      .getByRole('heading', { name: /^Third-party weight · 5 hosts/ })
      .closest('section')!;
    expect(within(third).getByText('cdn.tracker.io').getAttribute('title')).toBe('cdn.tracker.io');
    expect(within(third).getByText('197 KB')).toBeTruthy();
    expect(within(third).getByText('b.io')).toBeTruthy();
  });

  it('counts hosts of unknown size among the rest', () => {
    renderPage(Performance, {
      snap: pageSnap({
        resources: [resource('https://fonts.gstatic.com/s/inter.woff2', { type: 'css' })],
      }),
    });
    expect(screen.getByText('1 more host')).toBeTruthy();
  });
});
