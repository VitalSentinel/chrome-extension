import { cleanup, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CookieRow } from '../../../../src/lib/checks/tracking';
import Tech from '../../../../src/popup/pages/Tech';
import { resource } from '../../fixtures';
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

let data: ReturnType<typeof setupData>;
beforeEach(() => {
  data = setupData();
});
afterEach(cleanup);

const section = (name: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const now = Date.now() / 1000;
const cookie = (name: string, o: Partial<CookieRow> = {}): CookieRow => ({
  name,
  domain: '.example.com',
  purpose: 'unknown',
  secure: true,
  httpOnly: false,
  sameSite: 'lax',
  session: false,
  expires: now + 30 * 86_400,
  ...o,
});

describe('Tech and tracking', () => {
  it('shows a loading state, then a clean page', async () => {
    renderPage(Tech);
    expect(screen.getByText('Reading cookies and page scripts…')).toBeTruthy();
    expect(await screen.findByText('No known technologies detected.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tech stack · 0 detected' })).toBeTruthy();
    expect(screen.getByText('No known tracker requests.')).toBeTruthy();
    expect(screen.getByText('No Consent Mode commands found in the dataLayer.')).toBeTruthy();
    expect(screen.getByText('No cookies for this URL.')).toBeTruthy();
    expect(data.cookies).toHaveBeenCalledWith(PAGE_URL, 7);
    expect(data.probe).toHaveBeenCalledWith(7);
  });

  it('reports a failed scan', async () => {
    data.cookies.mockRejectedValue(new Error('No cookie store'));
    renderPage(Tech);
    expect(await screen.findByText('The page could not be scanned: No cookie store')).toBeTruthy();
  });

  it('detects the stack, trackers loaded before consent, Consent Mode and cookies', async () => {
    data.cookies.mockResolvedValue([
      cookie('_ga', { purpose: 'analytics', secure: false, expires: now + 400 * 86_400 }),
      cookie('_fbp', {
        purpose: 'marketing',
        sameSite: 'no_restriction',
        expires: now + 3 * 365 * 86_400,
      }),
      cookie('PHPSESSID', {
        purpose: 'necessary',
        httpOnly: true,
        session: true,
        sameSite: 'strict',
      }),
      cookie('short', { sameSite: 'unspecified', secure: false, expires: now + 1800 }),
      cookie('pref'),
    ]);
    data.probe.mockResolvedValue({
      globals: ['jQuery'],
      consentMode: {
        defaults: { ad_storage: 'denied', analytics_storage: 'granted' },
        updates: { ad_storage: 'granted' },
      },
    });
    const snap = pageSnap({
      scripts: [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123',
        'https://cdn.cookielaw.org/otSDKStub.js',
        'https://www.example.com/js/jquery-3.7.1.min.js',
      ],
      resources: [
        resource('https://www.google-analytics.com/g/collect?v=2', { type: 'beacon' }),
        resource('https://www.google-analytics.com/g/collect?v=2&x=1', { type: 'beacon' }),
        resource('https://connect.facebook.net/en_US/fbevents.js'),
      ],
    });
    renderPage(Tech, {
      snap,
      ctx: tabContext({
        nav: navRecord({ headers: [...SECURE_HEADERS, ['server', 'nginx/1.25.3']] }),
      }),
    });

    const stack = await screen
      .findByText(/^Tech stack · \d+ detected$/)
      .then(() => section(/^Tech stack/));
    expect(within(stack).getByText('Tag managers')).toBeTruthy();
    expect(within(stack).getByText('GTM-ABC123')).toBeTruthy();
    expect(within(stack).getByText('nginx')).toBeTruthy();
    expect(within(stack).getByText('1.25.3')).toBeTruthy();
    expect(within(stack).getByText('OneTrust')).toBeTruthy();
    expect(within(stack).getByText('3.7.1')).toBeTruthy();

    expect(screen.getByText('2 trackers and 2 cookies before consent')).toBeTruthy();
    const trackers = section('Trackers · 2');
    expect(within(trackers).getByText('Google Analytics').closest('.grid')!.textContent).toBe(
      'Google Analyticsanalytics2',
    );
    expect(within(trackers).getByText('Meta')).toBeTruthy();
    expect(
      within(trackers).getByText('Consent Mode default for ad_user_data is not set'),
    ).toBeTruthy();
    expect(within(trackers).queryByText('2 trackers and 2 cookies before consent')).toBeNull();

    const consent = section('Consent Mode v2');
    expect(within(consent).getAllByText('Denied')).toHaveLength(1);
    expect(within(consent).getAllByText('Granted')).toHaveLength(2);
    expect(within(consent).getAllByText('Not set')).toHaveLength(2);
    expect(within(consent).getAllByText('No update')).toHaveLength(3);
    // Keys may wrap only after an underscore.
    expect(within(consent).getByText('ad_personalization').querySelectorAll('wbr')).toHaveLength(1);

    const jar = section('Cookies · 5');
    const row = (name: string) => within(jar).getByText(name).closest('.grid')!.textContent;
    expect(row('_ga')).toContain('analytics');
    expect(row('_ga')).toContain('SameSite=Lax');
    expect(row('_ga')).toContain('13 months');
    expect(row('_ga')).toContain('Before consent');
    expect(row('_fbp')).toContain('Before consent');
    expect(row('PHPSESSID')).not.toContain('Before consent');
    expect(row('_fbp')).toContain('Secure, SameSite=None');
    expect(row('_fbp')).toContain('3 years');
    expect(row('PHPSESSID')).toContain('Secure, HttpOnly, SameSite=Strict');
    expect(row('PHPSESSID')).toContain('Session');
    expect(row('short')).toContain('–');
    expect(row('short')).toContain('1 h');
    expect(row('pref')).toContain('30 days');
  });
});
