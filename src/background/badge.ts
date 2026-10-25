import { browser } from 'wxt/browser';
import { overall, type Rating } from '../lib/vitals';
import type { TabVitals } from '../lib/types';

// Toolbar icon per tab: DR on the badge (purple; coloured by this load's Core Web Vitals when
// the user opts in), a grey mark while JavaScript is blocked, and a tooltip carrying the
// "Domain Rating by Ahrefs" credit.

export interface BadgeState {
  host: string;
  dr: number | null;
  showDr: boolean;
  js: 'allow' | 'block';
  cwv: Rating | null; // null unless colouring is on and a rating exists
}

const COLOURS: Record<Rating | 'default', string> = {
  default: '#6B21A8',
  good: '#15803D',
  'needs-improvement': '#B45309',
  poor: '#B91C1C',
};

export function badgeColour(state: Pick<BadgeState, 'cwv'>): string {
  return COLOURS[state.cwv ?? 'default'];
}

export function tooltip(state: BadgeState): string {
  const lines = [`VitalSentinel · ${state.host}`];
  if (state.dr !== null) lines.push(`DR ${Math.round(state.dr)} – Domain Rating by Ahrefs`);
  lines.push(state.js === 'block' ? 'JavaScript blocked' : 'JavaScript allowed');
  return lines.join('\n');
}

export function iconPath(state: Pick<BadgeState, 'js'>): Record<number, string> {
  const prefix = state.js === 'block' ? 'off-' : '';
  return { 16: `/icon/${prefix}16.png`, 32: `/icon/${prefix}32.png` };
}

export function cwvRating(vitals: TabVitals | null): Rating | null {
  if (!vitals) return null;
  return overall(['LCP', 'INP', 'CLS'].map((m) => vitals.metrics[m as 'LCP']?.rating));
}

export async function paint(tabId: number, state: BadgeState): Promise<void> {
  const text = state.showDr && state.dr !== null ? String(Math.round(state.dr)) : '';
  await Promise.all([
    browser.action.setBadgeText({ tabId, text }),
    browser.action.setBadgeBackgroundColor({ tabId, color: badgeColour(state) }),
    browser.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' }),
    browser.action.setTitle({ tabId, title: tooltip(state) }),
    // setIcon reports a closed tab as an unchecked lastError even with a promise; read it here.
    new Promise<void>((done) =>
      browser.action.setIcon({ tabId, path: iconPath(state) }, () => {
        void browser.runtime.lastError;
        done();
      }),
    ),
  ]).catch(() => {
    // The tab closed while painting.
  });
}
