import { cleanup, fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meta } from '../../fixtures';
import {
  MONITORED,
  SIGNED_IN,
  mockSend,
  pageSnap,
  renderPage,
  settingsFixture,
  stubCanvas,
  tabContext,
} from '../fixtures';
import { appOverview } from '../appOverview';

vi.mock('../../../../src/lib/messages', () => ({ send: vi.fn() }));

// Content.tsx creates its measuring canvas at module load, so stub it before importing.
stubCanvas();
const { default: Content } = await import('../../../../src/popup/pages/Content');

afterEach(cleanup);

const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const row = (label: string) =>
  within(section('Meta')).getByText(label).nextElementSibling as HTMLElement;
const length = (label: string) =>
  screen.getByRole('heading', { level: 2, name: label }).nextElementSibling as HTMLElement;

describe('title and description', () => {
  it('show each text with its length and width', () => {
    renderPage(Content);
    expect(length('Title').textContent).toBe('44 characters · 352 of 600 px');
    expect(length('Title').className).toContain('text-good-text');
    expect(length('Description').textContent).toBe('98 characters · 784 of 920 px');
    expect(screen.getAllByText('Core Web Vitals explained: a practical guide')).toHaveLength(2);
  });

  it('say when a tag is missing', () => {
    renderPage(Content, { snap: pageSnap({ title: '', meta: [] }) });
    expect(length('Title')).toBeNull();
    expect(screen.getAllByText('No title tag')).toHaveLength(2);
    expect(screen.getAllByText('No meta description')).toHaveLength(2);
  });
});

describe('Google snippet preview', () => {
  it('shows favicon, site name, breadcrumb URL, title and description', () => {
    const { container } = renderPage(Content);
    const serp = section('Google snippet preview');
    expect(within(serp).getByText('Example Blog')).toBeTruthy();
    expect(within(serp).getByText('https://www.example.com › blog › core-web-vitals')).toBeTruthy();
    expect(within(serp).getByText('Core Web Vitals explained: a practical guide')).toBeTruthy();
    expect(within(serp).getByText(/^What LCP, INP and CLS measure/)).toBeTruthy();
    expect(
      within(serp).getByText('Title and description show in full in desktop results.'),
    ).toBeTruthy();
    const icon = container.querySelector('img') as HTMLImageElement;
    expect(icon.getAttribute('src')).toBe('https://www.example.com/favicon.ico');
    expect(icon.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(icon);
    expect(container.querySelector('img')).toBeNull();
  });

  it('loads no favicon in offline mode', () => {
    const { container } = renderPage(Content, { settings: settingsFixture({ offline: true }) });
    expect(container.querySelector('img')).toBeNull();
  });

  it('cuts a title wider than 600 px like Google does', () => {
    const title =
      'A very long title about Core Web Vitals that keeps going and going past the limit';
    renderPage(Content, { snap: pageSnap({ title }) });
    const serp = section('Google snippet preview');
    expect(within(serp).getByText(/ …$/).textContent!.length).toBeLessThan(title.length);
    expect(length('Title').textContent).toBe(
      `${title.length} characters · ${title.length * 8} of 600 px – cut in search results`,
    );
    expect(length('Title').className).toContain('text-warn-text');
    expect(
      within(serp).getByText('Title is cut after "and going past" in desktop results.'),
    ).toBeTruthy();
  });

  it('falls back to the hostname, "No title" and Google-picked text', () => {
    renderPage(Content, { snap: pageSnap({ title: '', meta: [] }) });
    const serp = section('Google snippet preview');
    expect(within(serp).getByText('www.example.com')).toBeTruthy();
    expect(within(serp).getByText('No title')).toBeTruthy();
    expect(
      within(serp).getByText('No meta description – Google shows text it picks from the page.'),
    ).toBeTruthy();
  });
});

describe('meta', () => {
  it('lists language, words, author, dates and viewport', () => {
    renderPage(Content, {
      snap: pageSnap({
        meta: [
          ...pageSnap().meta,
          ...meta({
            'article:published_time': '2026-03-03T09:00:00Z',
            'article:modified_time': 'soon',
          }),
        ],
      }),
    });
    expect(row('Language').textContent).toBe('en');
    expect(row('Words').textContent).toBe('1,250');
    expect(row('Author').textContent).toBe('Jane Doe');
    expect(row('Published').textContent).toBe('Mar 3, 2026');
    expect(row('Modified').textContent).toBe('soon');
    expect(row('Viewport').textContent).toBe('width=device-width, initial-scale=1');
    expect(screen.getByText('Title length is good (44 characters)')).toBeTruthy();
  });

  it('flags a missing language and viewport and leaves out unknown rows', () => {
    renderPage(Content, { snap: pageSnap({ lang: '', meta: [] }) });
    expect(row('Language').textContent).toBe('Missing');
    expect(row('Language').className).toContain('text-warn-text');
    expect(row('Viewport').textContent).toBe('Missing');
    expect(within(section('Meta')).queryByText('Author')).toBeNull();
    expect(within(section('Meta')).queryByText('Published')).toBeNull();
  });
});

describe('headings outline', () => {
  it('summarises the levels', () => {
    renderPage(Content);
    expect(screen.getByRole('heading', { level: 2, name: 'Headings · 3' })).toBeTruthy();
    expect(screen.getByText('H1 1 · H2 1 · H3 1')).toBeTruthy();
    expect(within(section('Headings · 3')).getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks skipped levels and empty headings', () => {
    renderPage(Content, {
      snap: pageSnap({
        headings: [
          { level: 1, text: 'Guide' },
          { level: 3, text: 'Too deep' },
          { level: 2, text: '' },
          { level: 6, text: 'Deepest' },
        ],
      }),
    });
    const outline = section('Headings · 4');
    expect(within(outline).getByText('– skips from H1 to H3')).toBeTruthy();
    expect(within(outline).getByText('– skips from H2 to H6')).toBeTruthy();
    expect(within(outline).getByText('Empty heading')).toBeTruthy();
    expect(screen.getByText('Heading level skipped: H1 → H3')).toBeTruthy();
  });

  it('says when there are none', () => {
    renderPage(Content, { snap: pageSnap({ headings: [] }) });
    expect(screen.getByText('No headings on this page.')).toBeTruthy();
    expect(screen.getByText('No H1 heading')).toBeTruthy();
  });
});

describe('a monitored site', () => {
  it('adds Google Search for this page after the snippet preview', async () => {
    mockSend({ 'app:overview': () => ({ ok: true, data: appOverview() }) });
    renderPage(Content, { ctx: tabContext({ auth: SIGNED_IN, monitored: MONITORED }) });
    const gsc = screen
      .getByRole('heading', { level: 2, name: 'Google Search Console · Last 90 days' })
      .closest('section') as HTMLElement;
    expect(
      within(gsc).getByRole('status', { name: 'Loading Google Search Console · Last 90 days' }),
    ).toBeTruthy();
    expect(await screen.findByText('12k')).toBeTruthy();
    const loaded = screen
      .getByRole('heading', { level: 2, name: 'Google Search Console · Last 90 days' })
      .closest('section') as HTMLElement;
    expect(within(loaded).getByText('12k')).toBeTruthy();
    expect(within(loaded).getByText('core web vitals & seo')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Google Search Console · Last 90 days')).toBe(
      headings.indexOf('Google snippet preview') + 1,
    );
  });

  it('shows no search data for a site that is not monitored', () => {
    const send = mockSend();
    renderPage(Content);
    expect(screen.queryByText(/Google Search ·/)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
