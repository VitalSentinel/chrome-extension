import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { ORIGIN, startSite } from './server';

// Loads the unpacked build (npm run build) into Chromium. The manifest key pins the ID.
export const EXTENSION_ID = 'ppnfgofoagpedmdbggnmlfomgnhjljal';
const BUILD = resolve(import.meta.dirname, '../../.output/chrome-mv3');

export const test = base.extend<
  { context: BrowserContext; popup: (url: string) => Promise<{ site: Page; popup: Page }> },
  { site: void }
>({
  site: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take no dependencies here
    async ({}, use) => {
      const server = await startSite();
      await use();
      server.close();
    },
    { scope: 'worker', auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern -- no dependencies
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
    });
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
    // Accept the Terms in the popup, as a user would, so later popups show their reports. Domain
    // Rating is switched off so the tests make no calls to the app.
    const site = await context.newPage();
    await site.goto(`${ORIGIN}/page.html`);
    const tabId = await context
      .serviceWorkers()[0]
      .evaluate(
        async (u) =>
          (
            await (
              globalThis as unknown as { chrome: typeof import('wxt/browser').browser }
            ).chrome.tabs.query({})
          ).find((t) => t.url?.startsWith(u))?.id,
        ORIGIN,
      );
    const terms = await context.newPage();
    await terms.setViewportSize({ width: 800, height: 600 });
    await terms.goto(`chrome-extension://${EXTENSION_ID}/popup.html?tab=${tabId}`);
    await terms.getByRole('switch', { name: 'Domain Rating on the icon' }).click();
    await terms.getByRole('button', { name: 'Agree and continue' }).click();
    await expect(terms.getByRole('button', { name: 'Agree and continue' })).toHaveCount(0);
    await terms.close();
    await site.close();
    await use(context);
    await context.close();
  },
  /** Opens `url` in a tab, then the popup for that tab in its own 800×600 page. */
  popup: async ({ context }, use) => {
    await use(async (url) => {
      const site = await context.newPage();
      await site.goto(url);
      const [worker] = context.serviceWorkers();
      const tabId = await worker.evaluate(async (u) => {
        const c = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser })
          .chrome;
        return (await c.tabs.query({})).find((t) => t.url?.startsWith(u))?.id;
      }, url);
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 800, height: 600 });
      await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html?tab=${tabId}`);
      return { site, popup };
    });
  },
});

export { expect };
