import { vi } from 'vitest';

// vi.mock factories for the popup data layer and the messaging wrapper. This file imports
// nothing from src so a factory can load it while the mocked module is still being created.
//
//   vi.mock('../../../src/popup/data', async (orig) => (await import('./mocks')).dataModule(await orig()));
//   vi.mock('../../../src/lib/messages', () => ({ send: vi.fn() }));
//
// The stubs get their behaviour from setupData() / mockSend() in fixtures.tsx.

export function dataModule(actual: { useAsync: unknown }) {
  return {
    useAsync: actual.useAsync,
    currentTabId: vi.fn(),
    context: vi.fn(),
    settings: vi.fn(),
    saveSettings: vi.fn(),
    snapshot: vi.fn(),
    fetchText: vi.fn(),
    robots: vi.fn(),
    sitemaps: vi.fn(),
    sitemapsIfChecked: vi.fn(),
    rawSnapshot: vi.fn(),
    probe: vi.fn(),
    cookies: vi.fn(),
    runAxe: vi.fn(),
    overlay: vi.fn(),
    overlayShown: vi.fn(),
    reloadTab: vi.fn(),
    linkStatuses: vi.fn(),
    changesSinceLastVisit: vi.fn(),
    forget: vi.fn(),
    track: vi.fn(),
  };
}
