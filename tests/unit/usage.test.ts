import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '../../src/lib/config';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';

// Both statistics are opt-in; these tests start from a user who ticked both.
const OPTED_IN = { ...DEFAULT_SETTINGS, usageStats: true, errorReports: true };
import { EVENTS, bump, isUsageEvent, usageAllowed, usageReport, utcDay } from '../../src/lib/usage';
import { GROUPS } from '../../src/popup/nav';

const NOON = Date.UTC(2026, 9, 25, 12);

describe('usage events', () => {
  it('has a view event for every report tab', () => {
    const pages = [...GROUPS.flatMap((g) => g.pages.map((p) => p.key)), 'vs-all'].map(
      (k) => `page.${k}`,
    );
    for (const p of pages) expect(EVENTS).toContain(p);
    expect(new Set(EVENTS).size).toBe(EVENTS.length);
  });

  it('accepts only listed names', () => {
    expect(isUsageEvent('popup.open')).toBe(true);
    expect(isUsageEvent('page.https://example.com')).toBe(false);
    expect(isUsageEvent(42)).toBe(false);
  });
});

describe('bump', () => {
  it('adds one to the event of the UTC day', () => {
    let days = bump({}, 'popup.open', NOON);
    days = bump(days, 'popup.open', NOON);
    days = bump(days, 'axe.run', NOON + 86_400_000);
    expect(days).toEqual({
      '2026-10-25': { 'popup.open': 2 },
      '2026-10-26': { 'axe.run': 1 },
    });
  });

  it('uses UTC, not local time, for the day', () => {
    expect(utcDay(Date.UTC(2026, 9, 25, 23, 59))).toBe('2026-10-25');
  });
});

describe('usageReport', () => {
  it('carries the counts, the context and only yes/no settings', () => {
    const r = usageReport(
      '2026-10-24',
      { 'popup.open': 3 },
      { ...OPTED_IN, drConsent: true },
      { version: '1.0.1', browser: 'chrome', build: 'store', lang: 'en', signedIn: false },
    );
    expect(r).toEqual({
      schema: 1,
      day: '2026-10-24',
      version: '1.0.1',
      browser: 'chrome',
      build: 'store',
      lang: 'en',
      signedIn: false,
      flags: {
        drConsent: true,
        showDrBadge: true,
        cwvBadgeColour: false,
        rememberChanges: true,
      },
      counts: { 'popup.open': 3 },
    });
  });
});

describe('usageReport without usage statistics', () => {
  it('carries only error counts and no settings', () => {
    const r = usageReport(
      '2026-10-24',
      { 'popup.open': 3, 'error.app': 1 },
      { ...OPTED_IN, usageStats: false },
      { version: '1.0.1', browser: 'edge', build: 'dev', lang: 'sk', signedIn: true },
    );
    expect(r.counts).toEqual({ 'error.app': 1 });
    expect(r.flags).toBeUndefined();
  });
});

describe('usageAllowed', () => {
  const accepted = { ...OPTED_IN, termsAccepted: TERMS_VERSION };
  it('needs the current Terms, a switch on and offline mode off', () => {
    expect(usageAllowed(accepted, TERMS_VERSION)).toBe(true);
    expect(usageAllowed(DEFAULT_SETTINGS, TERMS_VERSION)).toBe(false);
    // Accepting the Terms alone sends nothing: both statistics are opt-in.
    const defaults = { ...DEFAULT_SETTINGS, termsAccepted: TERMS_VERSION };
    expect(usageAllowed(defaults, TERMS_VERSION)).toBe(false);
    expect(usageAllowed(defaults, TERMS_VERSION, 'error.app')).toBe(false);
    expect(usageAllowed({ ...accepted, termsAccepted: '2020-01-01' }, TERMS_VERSION)).toBe(false);
    expect(
      usageAllowed({ ...accepted, usageStats: false, errorReports: false }, TERMS_VERSION),
    ).toBe(false);
    expect(usageAllowed({ ...accepted, offline: true }, TERMS_VERSION)).toBe(false);
  });

  it('checks the switch of the event', () => {
    const errorsOnly = { ...accepted, usageStats: false };
    expect(usageAllowed(errorsOnly, TERMS_VERSION)).toBe(true);
    expect(usageAllowed(errorsOnly, TERMS_VERSION, 'error.dr')).toBe(true);
    expect(usageAllowed(errorsOnly, TERMS_VERSION, 'popup.open')).toBe(false);
    expect(usageAllowed({ ...accepted, errorReports: false }, TERMS_VERSION, 'error.dr')).toBe(
      false,
    );
  });
});
