import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '../../../src/popup/Agreement';
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '../../../src/lib/config';
import type { Settings } from '../../../src/lib/settings';
import { mockSend, settingsFixture, setupData } from './fixtures';

vi.mock('../../../src/popup/data', async (orig) =>
  (await import('./mocks')).dataModule(await orig()),
);
vi.mock('../../../src/lib/messages', () => ({ send: vi.fn() }));

let data: ReturnType<typeof setupData>;
let send: ReturnType<typeof mockSend>;
let onAgree: (s: Settings) => void;
beforeEach(() => {
  data = setupData();
  send = mockSend();
  onAgree = vi.fn();
});
afterEach(cleanup);

const DR = 'Domain Rating on the icon';
const STATS = 'Share anonymous usage and error counts';
const toggle = (name: string) => screen.getByRole('switch', { name });
const on = (name: string) => toggle(name).getAttribute('aria-checked') === 'true';
const agree = () => fireEvent.click(screen.getByRole('button', { name: 'Agree and continue' }));
const show = (s = settingsFixture({ termsAccepted: '' })) =>
  render(<Onboarding settings={s} onAgree={onAgree} />);

describe('Onboarding', () => {
  it('starts Domain Rating on and the anonymous counts off', () => {
    show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'See what holds any page back, in one click',
    );
    expect([on(DR), on(STATS)]).toEqual([true, false]);
    expect(screen.getByRole('link', { name: 'Terms and Conditions' }).getAttribute('href')).toBe(
      TERMS_URL,
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(
      PRIVACY_URL,
    );
  });

  it('flips a switch from a click anywhere on its row, but not from a link', () => {
    show();
    fireEvent.click(screen.getByText(/so we can fix bugs/));
    expect(on(STATS)).toBe(true);
    fireEvent.click(toggle(STATS));
    expect(on(STATS)).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Privacy Policy' }));
    expect(on(STATS)).toBe(false);
  });

  it('saves every choice with the Terms, refreshes the badge and counts the install', async () => {
    show();
    fireEvent.click(toggle(STATS));
    agree();
    await waitFor(() => expect(onAgree).toHaveBeenCalled());
    expect(data.saveSettings).toHaveBeenCalledWith({
      termsAccepted: TERMS_VERSION,
      drConsent: true,
      errorReports: true,
      usageStats: true,
    });
    expect(send).toHaveBeenCalledWith('badge:refresh', {});
    expect(data.track).toHaveBeenCalledWith('install');
  });

  it('keeps everything off when each switch is turned off', async () => {
    show();
    fireEvent.click(toggle(DR));
    agree();
    await waitFor(() =>
      expect(data.saveSettings).toHaveBeenCalledWith({
        termsAccepted: TERMS_VERSION,
        drConsent: false,
        errorReports: false,
        usageStats: false,
      }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('starts newer Terms from the earlier choices and counts no second install', async () => {
    show(
      settingsFixture({
        termsAccepted: '2020-01-01',
        drConsent: false,
        errorReports: false,
        usageStats: false,
      }),
    );
    expect([on(DR), on(STATS)]).toEqual([false, false]);
    agree();
    await waitFor(() => expect(onAgree).toHaveBeenCalled());
    expect(data.track).not.toHaveBeenCalled();
  });

  it('lets the button be pressed again when saving fails', async () => {
    data.saveSettings.mockRejectedValueOnce(new Error('quota'));
    show();
    agree();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Agree and continue' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(onAgree).not.toHaveBeenCalled();
  });
});
