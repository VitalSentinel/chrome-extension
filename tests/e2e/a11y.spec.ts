import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { EXTENSION_ID, expect, test } from './fixtures';
import { PAGES } from './pages';
import { ORIGIN } from './server';

// WCAG 2.1 AA with axe-core on every extension page, in light and dark mode. axe is evaluated
// over CDP, which the extension's content security policy does not block.
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function violations(page: Page, where: string) {
  await page.evaluate(AXE);
  const found = await page.evaluate(async () => {
    const axe = (globalThis as unknown as { axe: typeof import('axe-core') }).axe;
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations.map(
      (v) =>
        `${v.id}: ${v.help} – ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(', ')}`,
    );
  });
  return found.map((f) => `${where} › ${f}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`popup, settings and the Terms screen pass WCAG 2.1 AA in ${scheme} mode`, async ({
    context,
    popup,
  }) => {
    test.setTimeout(240_000);
    const { popup: p } = await popup(`${ORIGIN}/page.html`);
    await p.emulateMedia({ colorScheme: scheme });
    const nav = p.getByRole('navigation', { name: 'Report' });
    const all: string[] = [];
    for (const [group, sub, heading] of PAGES) {
      await nav
        .getByRole('button', { name: new RegExp(`^${group}`) })
        .first()
        .click();
      if (sub !== group) await nav.getByRole('button', { name: new RegExp(`^${sub}`) }).click();
      await expect(p.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      // Let the page's own loading finish so the finished report is what gets checked. The site
      // is a background tab here, where Chrome slows the timers axe-core yields on.
      await expect(p.getByRole('status')).toHaveCount(0, { timeout: 60_000 });
      all.push(...(await violations(p, heading)));
    }
    for (const path of ['options.html']) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`chrome-extension://${EXTENSION_ID}/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      all.push(...(await violations(page, path)));
    }
    // The Terms screen the popup shows before acceptance.
    const [worker] = context.serviceWorkers();
    await worker.evaluate(() =>
      (
        globalThis as unknown as { chrome: typeof import('wxt/browser').browser }
      ).chrome.storage.local.set({ settings: { termsAccepted: '' } }),
    );
    await p.reload();
    await expect(p.getByRole('button', { name: 'Agree and continue' })).toBeVisible();
    all.push(...(await violations(p, 'terms')));
    expect(all).toEqual([]);
  });
}
