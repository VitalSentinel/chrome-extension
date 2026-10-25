import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import Headers from '../../../../src/popup/pages/Headers';
import * as data from '../../../../src/popup/data';
import {
  PAGE_URL,
  SECURE_HEADERS,
  navRecord,
  pageSnap,
  renderPage,
  setupData,
  tabContext,
} from '../fixtures';

vi.mock('../../../../src/popup/data', async (orig) =>
  (await import('../mocks')).dataModule(await orig()),
);

afterEach(cleanup);

const writeText = vi.fn();
beforeEach(() => {
  fakeBrowser.reset();
  setupData();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const fact = (label: string) => screen.getByText(label).nextElementSibling!.textContent;
const check = (header: string) =>
  within(section('Security headers')).getByText(header).closest('.grid')!.lastElementChild!
    .textContent;

describe('without a recorded response', () => {
  // It used to re-read the context as soon as the reload started, before the new response
  // existed, and the button then stayed at "Reloading…" for good.
  it('reloads the tab, waits for it to load, then re-reads the context', async () => {
    let loaded!: () => void;
    vi.mocked(data.reloadTab).mockReturnValue(new Promise<void>((r) => (loaded = r)));
    const { props } = renderPage(Headers, { ctx: tabContext({ nav: null }) });
    expect(screen.getByText('No response recorded for this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    const busy = await screen.findByRole('button', { name: 'Reloading…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(data.reloadTab).toHaveBeenCalledWith(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(props.reload).not.toHaveBeenCalled();
    loaded();
    await waitFor(() => expect(props.reload).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Reload page' })).toBeTruthy();
  });

  it('names the status the page reports itself, and treats a status-less record as none', () => {
    renderPage(Headers, {
      ctx: tabContext({ nav: navRecord({ status: 0, headers: [] }) }),
      snap: pageSnap({ status: 200 }),
    });
    expect(screen.getByText(/^The page reports HTTP 200 itself\./)).toBeTruthy();
  });

  // A reload cannot help: the service worker answers it again, out of webRequest's sight.
  it('says its service worker answered the page, without offering a reload', () => {
    renderPage(Headers, {
      ctx: tabContext({ nav: null }),
      snap: pageSnap({ status: 200, serviceWorker: true }),
    });
    expect(screen.getByText('Served by a service worker')).toBeTruthy();
    expect(screen.getByText(/^The page reports HTTP 200 itself\./).textContent).toContain(
      'service worker',
    );
    expect(screen.queryByText(/before the extension started/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
  });
});

describe('with a recorded response', () => {
  it('shows the status, a direct answer and every security header set', () => {
    renderPage(Headers);
    expect(screen.getByRole('heading', { level: 1, name: 'HTTP headers' })).toBeTruthy();
    expect(screen.getByText('OK').previousElementSibling!.textContent).toBe('200');
    expect(fact('Security')).toBe('6 of 6 headers');
    expect(fact('Transport')).toBe('HTTP/1.1 · HTTPS');
    expect(fact('Caching')).toBe('max-age=300');
    expect(fact('Compression')).toBe('Brotli');
    expect(within(section(/^Redirect chain/)).getByText(PAGE_URL)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Redirect chain · 0 hops' })).toBeTruthy();
    expect(screen.getByText('No server redirects – the URL answered directly.')).toBeTruthy();
    expect(screen.getByText('6 of 6 set')).toBeTruthy();
    expect(check('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    expect(screen.getByText('Compressed with br')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: `Response headers · ${SECURE_HEADERS.length}` }),
    ).toBeTruthy();
    expect(within(section(/^Response headers/)).getByText('nosniff')).toBeTruthy();
  });

  it('walks the redirect chain and flags missing headers', () => {
    const nav = navRecord({
      status: 404,
      statusLine: '',
      redirects: [
        {
          url: 'http://example.com/blog/cwv',
          status: 301,
          location: 'https://example.com/blog/cwv',
        },
        { url: 'https://example.com/blog/cwv', status: 302, location: PAGE_URL },
      ],
      headers: [
        ['set-cookie', 'a=1'],
        ['cache-control', 'public, max-age=60'],
        ['vary', 'User-Agent'],
      ],
    });
    renderPage(Headers, { ctx: tabContext({ nav }) });
    expect(screen.getByText('HTTP').previousElementSibling!.textContent).toBe('404');
    expect(fact('Security')).toBe('0 of 6 headers');
    expect(fact('Caching')).toBe('public, max-age=60');
    expect(fact('Compression')).toBe('None');
    const chain = section('Redirect chain · 2 hops');
    expect(within(chain).getByText('301')).toBeTruthy();
    expect(within(chain).getByText('302')).toBeTruthy();
    expect(
      within(chain).getByText('Redirect chain of 2 hops – link to the final URL'),
    ).toBeTruthy();
    expect(within(chain).getByText('HTTP → HTTPS redirect')).toBeTruthy();
    expect(screen.getByText('0 of 6 set')).toBeTruthy();
    expect(check('Content-Security-Policy')).toBe('No Content-Security-Policy');
    expect(screen.getByText('HTML served without compression')).toBeTruthy();
    expect(screen.getByText('Cache-Control: public on a response that sets cookies')).toBeTruthy();
    expect(screen.getByText('Vary: User-Agent lowers CDN cache hits')).toBeTruthy();
  });

  it('flags a short HSTS, plain HTTP, and splits long values into parts', () => {
    const csp = `default-src 'self'; script-src 'self' https://cdn.example.com; img-src * data:; frame-ancestors 'none'`;
    renderPage(Headers, {
      ctx: tabContext({
        nav: navRecord({
          url: 'http://example.com/',
          statusLine: 'HTTP/2 200',
          headers: [
            ['strict-transport-security', 'max-age=60'],
            ['content-security-policy', csp],
            ['content-encoding', 'zstd'],
          ],
        }),
      }),
    });
    expect(fact('Transport')).toBe('HTTP/2 · Plain HTTP');
    expect(fact('Compression')).toBe('Zstandard');
    expect(fact('Security')).toBe('2 of 6 headers');
    expect(check('Strict-Transport-Security')).toBe('Page is not served over HTTPSmax-age=60');
    const all = section(/^Response headers/);
    expect(within(all).getByText('img-src * data:;')).toBeTruthy();
    expect(within(all).getByText("frame-ancestors 'none'")).toBeTruthy();
  });

  it('names one hop in the singular', () => {
    renderPage(Headers, {
      ctx: tabContext({
        nav: navRecord({
          redirects: [{ url: 'https://example.com/', status: 307, location: PAGE_URL }],
        }),
      }),
    });
    expect(screen.getByRole('heading', { name: 'Redirect chain · 1 hop' })).toBeTruthy();
  });

  it('copies all response headers', async () => {
    renderPage(Headers);
    fireEvent.click(screen.getByRole('button', { name: 'Copy headers' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(SECURE_HEADERS.map(([k, v]) => `${k}: ${v}`).join('\n'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy headers' })).toBeTruthy(), {
      timeout: 2500,
    });
  });

  it('cannot copy when no headers were recorded', () => {
    renderPage(Headers, { ctx: tabContext({ nav: navRecord({ headers: [] }) }) });
    expect(
      (screen.getByRole('button', { name: 'Copy headers' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('No response headers were recorded.')).toBeTruthy();
  });
});
