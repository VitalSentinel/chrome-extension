import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  badgeColour,
  cwvRating,
  iconPath,
  paint,
  tooltip,
  type BadgeState,
} from '../../../src/background/badge';
import type { TabVitals, VitalSample } from '../../../src/lib/types';

const state = (overrides: Partial<BadgeState> = {}): BadgeState => ({
  host: 'www.example.com',
  dr: 71.4,
  showDr: true,
  js: 'allow',
  cwv: null,
  ...overrides,
});

const sample = (
  name: VitalSample['name'],
  rating: VitalSample['rating'],
  value = 1,
): VitalSample => ({ name, rating, value });
const vitals = (...samples: VitalSample[]): TabVitals => ({
  url: 'https://www.example.com/',
  metrics: Object.fromEntries(samples.map((s) => [s.name, s])),
  shifts: [],
});

describe('badgeColour', () => {
  it.each([
    [null, '#6B21A8'],
    ['good', '#15803D'],
    ['needs-improvement', '#B45309'],
    ['poor', '#B91C1C'],
  ] as const)('%s → %s', (cwv, colour) => {
    expect(badgeColour({ cwv })).toBe(colour);
  });
});

describe('tooltip', () => {
  it('credits Ahrefs on the DR line', () => {
    expect(tooltip(state())).toBe(
      'VitalSentinel · www.example.com\nDR 71 – Domain Rating by Ahrefs\nJavaScript allowed',
    );
  });

  it('has no DR line and no credit without a rating', () => {
    const text = tooltip(state({ dr: null }));
    expect(text).toBe('VitalSentinel · www.example.com\nJavaScript allowed');
    expect(text).not.toContain('Ahrefs');
  });

  it('shows a DR of 0', () => {
    expect(tooltip(state({ dr: 0 }))).toContain('DR 0 – Domain Rating by Ahrefs');
  });

  it('names blocked JavaScript', () => {
    expect(tooltip(state({ dr: null, js: 'block' }))).toBe(
      'VitalSentinel · www.example.com\nJavaScript blocked',
    );
  });
});

describe('iconPath', () => {
  it.each([
    { js: 'allow', prefix: '' },
    { js: 'block', prefix: 'off-' },
  ] as const)('js $js → "$prefix"', ({ js, prefix }) => {
    expect(iconPath({ js })).toEqual({
      16: `/icon/${prefix}16.png`,
      32: `/icon/${prefix}32.png`,
    });
  });
});

describe('cwvRating', () => {
  it.each([
    { name: 'no vitals', v: null, rating: null },
    {
      name: 'no core metrics yet',
      v: vitals(sample('FCP', 'poor'), sample('TTFB', 'poor')),
      rating: null,
    },
    { name: 'all good', v: vitals(sample('LCP', 'good'), sample('CLS', 'good')), rating: 'good' },
    {
      name: 'one needs improvement',
      v: vitals(sample('LCP', 'good'), sample('INP', 'needs-improvement')),
      rating: 'needs-improvement',
    },
    {
      name: 'one poor',
      v: vitals(sample('LCP', 'needs-improvement'), sample('CLS', 'poor'), sample('INP', 'good')),
      rating: 'poor',
    },
  ])('$name → $rating', ({ v, rating }) => {
    expect(cwvRating(v)).toBe(rating);
  });
});

describe('paint', () => {
  let action: Record<
    'setBadgeText' | 'setBadgeBackgroundColor' | 'setBadgeTextColor' | 'setTitle' | 'setIcon',
    ReturnType<typeof vi.fn>
  >;

  beforeEach(() => {
    fakeBrowser.reset();
    action = {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setBadgeTextColor: vi.fn(async () => {}),
      setTitle: vi.fn(async () => {}),
      // Callback style, as paint() calls it.
      setIcon: vi.fn((_d: unknown, done: () => void) => done()),
    };
    Object.assign(fakeBrowser.action, action);
  });

  it('sets text, colours, title and icon for the tab', async () => {
    const s = state({ cwv: 'poor' });
    await paint(42, s);
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 42, text: '71' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 42, color: '#B91C1C' });
    expect(action.setBadgeTextColor).toHaveBeenCalledWith({ tabId: 42, color: '#FFFFFF' });
    expect(action.setTitle).toHaveBeenCalledWith({ tabId: 42, title: tooltip(s) });
    expect(action.setIcon).toHaveBeenCalledWith(
      { tabId: 42, path: { 16: '/icon/16.png', 32: '/icon/32.png' } },
      expect.any(Function),
    );
  });

  it.each([
    { name: 'the badge is off', s: state({ showDr: false }) },
    { name: 'there is no rating', s: state({ dr: null }) },
  ])('leaves the text empty when $name', async ({ s }) => {
    await paint(1, s);
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: '' });
  });

  it('works where setBadgeTextColor does not exist', async () => {
    (fakeBrowser.action as { setBadgeTextColor?: unknown }).setBadgeTextColor = undefined;
    await expect(paint(1, state())).resolves.toBeUndefined();
    expect(action.setTitle).toHaveBeenCalled();
  });

  it('swallows the error of a tab that closed while painting', async () => {
    action.setTitle.mockRejectedValue(new Error('No tab with id: 7.'));
    await expect(paint(7, state())).resolves.toBeUndefined();
  });

  it('reads the lastError setIcon reports for a closed tab', async () => {
    const lastError = vi.fn(() => ({ message: 'No tab with id: 7.' }));
    Object.defineProperty(fakeBrowser.runtime, 'lastError', { get: lastError, configurable: true });
    await expect(paint(7, state())).resolves.toBeUndefined();
    expect(lastError).toHaveBeenCalled();
  });
});
