import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Links from '../../../../src/popup/pages/Links';
import { link } from '../../fixtures';
import { pageSnap, renderPage, settingsFixture, setupData } from '../fixtures';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
});
afterEach(cleanup);

const stat = (label: string) =>
  screen.getAllByText(label, { selector: 'span' })[0].nextElementSibling!.textContent;
const filter = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Filter links' })).getByRole('button', { name });
const check = () =>
  screen.getByRole('button', { name: /^(Check status|Checking…)$/ }) as HTMLButtonElement;
const anchors = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'));
const statusOf = (href: string) =>
  screen.getByRole('link', { name: href }).closest('.grid')!.lastElementChild!.textContent;

const mixed = pageSnap({
  links: [
    link('https://www.example.com/', { text: 'Home' }),
    link('https://www.example.com/old', { text: '' }),
    link('https://partner.com/deal', { text: 'Deal', rel: 'nofollow sponsored' }),
    link('https://forum.example.org/t/1', { text: 'Thread', rel: 'ugc' }),
    link('https://www.example.com/admin', { text: 'Admin', rel: 'nofollow' }),
    link('http://insecure.example.net/', { text: 'Old site' }),
  ],
});

describe('Links', () => {
  it('summarises the links and lists them all', () => {
    renderPage(Links);
    expect(stat('Total')).toBe('3');
    expect(stat('Internal')).toBe('2');
    expect(stat('External')).toBe('1');
    expect(stat('Nofollow')).toBe('0');
    expect(stat('Unique')).toBe('3');
    expect(anchors()).toEqual([
      'https://www.example.com/',
      'https://www.example.com/blog/inp',
      'https://web.dev/articles/vitals',
    ]);
    expect(screen.getAllByText('–')).toHaveLength(3);
  });

  it('marks rel values, empty anchors and link findings', () => {
    renderPage(Links, { snap: mixed });
    expect(screen.getByText('No anchor text')).toBeTruthy();
    expect(screen.getByText('nofollow · sponsored').className).toContain('text-ink-2');
    expect(screen.getByText('ugc')).toBeTruthy();
    // nofollow on an internal link wastes link equity: amber.
    expect(screen.getByText('nofollow').className).toContain('text-warn-text');
    expect(screen.getByText('1 link without text')).toBeTruthy();
    expect(screen.getByText('1 internal link with nofollow')).toBeTruthy();
    expect(screen.getByText('1 link to http:// URLs')).toBeTruthy();
  });

  it('filters by internal, external and nofollow', () => {
    renderPage(Links, { snap: mixed });
    fireEvent.click(filter(/^External/));
    expect(filter(/^External/).getAttribute('aria-pressed')).toBe('true');
    expect(anchors()).toEqual([
      'https://partner.com/deal',
      'https://forum.example.org/t/1',
      'http://insecure.example.net/',
    ]);
    fireEvent.click(filter(/^Internal/));
    expect(anchors()).toEqual([
      'https://www.example.com/',
      'https://www.example.com/old',
      'https://www.example.com/admin',
    ]);
    fireEvent.click(filter(/^Nofollow/));
    expect(anchors()).toEqual(['https://partner.com/deal', 'https://www.example.com/admin']);
    fireEvent.click(filter(/^All/));
    expect(anchors()).toHaveLength(6);
  });

  it('says when a filter matches nothing and when there are no links', () => {
    const { unmount } = renderPage(Links);
    fireEvent.click(filter(/^Nofollow 0/));
    expect(screen.getByText('No links match this filter.')).toBeTruthy();
    expect(check().disabled).toBe(true);
    unmount();
    renderPage(Links, { snap: pageSnap({ links: [] }) });
    expect(screen.getByText('No links on this page.')).toBeTruthy();
  });
});

describe('non-web links', () => {
  it('shows an ftp: link as text and never checks it', () => {
    renderPage(Links, {
      snap: pageSnap({
        links: [
          link('ftp://files.example.com/a.zip', { text: 'Archive' }),
          link('https://www.example.com/', { text: 'Home' }),
        ],
      }),
    });
    expect(screen.getByText('ftp://files.example.com/a.zip').tagName).toBe('SPAN');
    expect(screen.queryByRole('link', { name: 'ftp://files.example.com/a.zip' })).toBeNull();
    fireEvent.click(check());
    expect(data.linkStatuses).toHaveBeenCalledWith(
      ['https://www.example.com/'],
      expect.any(Function),
    );
  });
});

describe('Check status', () => {
  it('fills in each status as results arrive', async () => {
    data.linkStatuses.mockImplementation(async (urls, onResult) => {
      onResult(urls[0], 200);
      onResult(urls[1], 301);
      onResult(urls[2], 0);
    });
    renderPage(Links);
    fireEvent.click(check());
    expect(data.linkStatuses).toHaveBeenCalledWith(
      [
        'https://www.example.com/',
        'https://www.example.com/blog/inp',
        'https://web.dev/articles/vitals',
      ],
      expect.any(Function),
    );
    await waitFor(() => expect(statusOf('https://www.example.com/')).toBe('200'));
    expect(statusOf('https://www.example.com/blog/inp')).toBe('301');
    expect(statusOf('https://web.dev/articles/vitals')).toBe('Error');
    expect(
      screen.getByText('Status checked for 3 of 3 links · 6 at a time, straight from your browser'),
    ).toBeTruthy();
    expect(check().disabled).toBe(false);
  });

  it('shows progress while checking', async () => {
    let finish!: () => void;
    data.linkStatuses.mockImplementation((urls, onResult) => {
      onResult(urls[0], 200);
      return new Promise<void>((r) => (finish = r));
    });
    renderPage(Links);
    fireEvent.click(check());
    expect(check().textContent).toBe('Checking…');
    expect(check().disabled).toBe(true);
    expect(screen.getAllByText('…')).toHaveLength(3);
    await waitFor(() => expect(screen.getByText(/^Checking 1 of 3 links/)).toBeTruthy());
    finish();
    await waitFor(() => expect(check().textContent).toBe('Check status'));
  });

  it('adds a Broken filter once a link fails', async () => {
    data.linkStatuses.mockImplementation(async (urls, onResult) =>
      urls.forEach((u) => onResult(u, u.includes('inp') ? 404 : 200)),
    );
    renderPage(Links);
    expect(screen.queryByRole('button', { name: /^Broken/ })).toBeNull();
    fireEvent.click(check());
    await waitFor(() => expect(filter(/^Broken 1/)).toBeTruthy());
    fireEvent.click(filter(/^Broken 1/));
    expect(anchors()).toEqual(['https://www.example.com/blog/inp']);
    expect(statusOf('https://www.example.com/blog/inp')).toBe('404');
    expect(screen.getByText('404').className).toContain('bg-poor-solid');
    expect(filter(/^Broken 1/).className).toContain('text-accent-text');
    fireEvent.click(filter(/^All/));
    expect(filter(/^Broken 1/).className).toContain('text-poor-text');
    expect(screen.getAllByText('200')[0].className).toContain('bg-good-tint');
  });

  it('reports a check that stops', async () => {
    data.linkStatuses.mockRejectedValue(new Error('aborted'));
    renderPage(Links);
    fireEvent.click(check());
    expect(await screen.findByText('The check stopped: aborted')).toBeTruthy();
  });

  it('checks only links on the same host in offline mode', () => {
    renderPage(Links, { settings: settingsFixture({ offline: true }) });
    expect(
      screen.getByText('Offline mode is on, so only links on this host are checked.'),
    ).toBeTruthy();
    fireEvent.click(check());
    expect(data.linkStatuses).toHaveBeenCalledWith(
      ['https://www.example.com/', 'https://www.example.com/blog/inp'],
      expect.any(Function),
    );
  });

  it('caps a long list at 300 checks', () => {
    const many = Array.from({ length: 320 }, (_, i) =>
      link(`https://www.example.com/p/${i}`, { text: `Page ${i}` }),
    );
    renderPage(Links, { snap: pageSnap({ links: many }) });
    expect(screen.getByText('Only the first 300 links of this list are checked.')).toBeTruthy();
    fireEvent.click(check());
    expect(data.linkStatuses.mock.calls[0][0]).toHaveLength(300);
  });
});
