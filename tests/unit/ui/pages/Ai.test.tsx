import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ai from '../../../../src/popup/pages/Ai';
import { meta } from '../../fixtures';
import { ORIGIN, PAGE_URL, pageSnap, renderPage, robotsResult, setupData } from '../fixtures';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
});
afterEach(cleanup);

const check = (label: string) =>
  screen.getByText(label, { selector: 'span.font-medium' }).nextElementSibling!.textContent;
const fetched = (status: number, contentType: string, text = '') => ({
  status,
  text,
  contentType,
  url: '',
});

describe('AI readiness', () => {
  it('scores the page and links a crawler block to the Crawlers page', async () => {
    const { props } = renderPage(Ai);
    expect(screen.getByText('Checking what AI agents can read…')).toBeTruthy();
    expect(await screen.findByRole('img', { name: '7 of 10' })).toBeTruthy();
    expect(screen.getByText('AI agents can read most of this page')).toBeTruthy();
    expect(screen.getByText('7 of 10 checks passed · 1 to fix · 2 optional')).toBeTruthy();
    expect(check('AI crawler access')).toBe('GPTBot blocked in robots.txt · Crawlers ›');
    expect(check('llms.txt')).toBe('No /llms.txt');
    // Rows to fix are tinted; optional and passed ones are not.
    expect(screen.getByText('AI crawler access').parentElement!.className).toContain(
      'bg-warn-tint',
    );
    expect(screen.getByText('llms.txt').parentElement!.className).not.toContain('tint');
    expect(check('Content without JavaScript')).toBe('Main content is in the raw HTML');
    expect(check('Sitemap')).toBe('Listed in the sitemap');
    expect(data.sitemaps).not.toHaveBeenCalled(); // only Indexability fetches sitemaps
    fireEvent.click(screen.getByRole('button', { name: 'Crawlers ›' }));
    expect(props.go).toHaveBeenCalledWith('crawlers');
    expect(data.fetchText).toHaveBeenCalledWith(`${ORIGIN}/llms.txt`);
    expect(data.fetchText).toHaveBeenCalledWith(`${PAGE_URL}.md`, { method: 'HEAD' });
  });

  it('passes everything with llms.txt, a Markdown twin and open robots.txt', async () => {
    data.robots.mockResolvedValue(robotsResult('User-agent: *\nAllow: /\n'));
    data.fetchText.mockImplementation(async (url) =>
      url.endsWith('/llms.txt')
        ? fetched(200, 'text/plain', '# Example\n- [Guide](https://www.example.com/guide)\n')
        : fetched(200, 'text/markdown'),
    );
    renderPage(Ai);
    expect(await screen.findByText('AI agents can read this page well')).toBeTruthy();
    expect(check('llms.txt')).toMatch(/^llms\.txt found · .* · 1 link$/);
    expect(check('Markdown version')).toBe('A Markdown version is available');
    expect(screen.queryByRole('button', { name: 'Crawlers ›' })).toBeNull();
  });

  it('finds Markdown by content negotiation when there is no .md twin', async () => {
    data.fetchText.mockImplementation(async (url, init) =>
      init?.headers
        ? fetched(200, 'text/markdown; charset=utf-8')
        : url.endsWith('.md')
          ? fetched(404, 'text/html')
          : Promise.reject(new Error('offline')),
    );
    renderPage(Ai, { snap: pageSnap({ url: `${ORIGIN}/` }) });
    expect(await screen.findByText('A Markdown version is available')).toBeTruthy();
    expect(data.fetchText).toHaveBeenCalledWith(`${ORIGIN}/index.md`, { method: 'HEAD' });
  });

  it('explains a page agents will struggle with', async () => {
    data.robots.mockResolvedValue(null);
    data.rawSnapshot.mockRejectedValue(new Error('timeout'));
    data.sitemapsIfChecked.mockResolvedValue(null); // Indexability not opened yet
    data.fetchText.mockRejectedValue(new Error('offline'));
    const snap = pageSnap({
      jsonLd: [],
      meta: meta({ robots: 'noai' }),
      semantic: { main: false, article: false, nav: false, header: false, footer: false },
      htmlBytes: 3_000_000,
    });
    renderPage(Ai, { snap });
    expect(await screen.findByText('AI agents will struggle with this page')).toBeTruthy();
    expect(check('Content without JavaScript')).toBe('Raw HTML could not be read');
    expect(check('Semantic HTML')).toBe('No <main> element');
    expect(check('noai / noimageai')).toBe('AI opt-out set: noai / noimageai');
    expect(screen.queryByText('Sitemap', { selector: 'span.font-medium' })).toBeNull();
  });

  it('reports a failed check', async () => {
    data.robots.mockRejectedValue(new Error('robots exploded'));
    renderPage(Ai);
    expect(
      await screen.findByText('AI readiness could not be checked: robots exploded'),
    ).toBeTruthy();
  });
});
