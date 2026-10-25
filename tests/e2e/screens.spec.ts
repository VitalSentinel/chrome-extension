import { expect, test } from './fixtures';

// Screenshots of every popup page for a real site, for design review. Opt-in:
//   SHOTS=https://example.com npx playwright test screens
// Images land in test-results/screens/, one per page at full scroll height.
const SITE = process.env.SHOTS;

const PAGES: [string, string][] = [
  ['Overview', 'Overview'],
  ['On-page', 'Content'],
  ['On-page', 'Structured data'],
  ['On-page', 'Social tags'],
  ['On-page', 'Images'],
  ['Crawl and index', 'Indexability'],
  ['Crawl and index', 'Crawlers'],
  ['Crawl and index', 'Links'],
  ['Performance', 'Performance'],
  ['Technical', 'HTTP headers'],
  ['Technical', 'Tech and tracking'],
  ['Technical', 'Accessibility'],
  ['Technical', 'AI readiness'],
  ['VitalSentinel', 'VitalSentinel'],
];

test.skip(!SITE, 'set SHOTS=<url> to take review screenshots');

test('screenshots of every popup page', async ({ popup }) => {
  test.setTimeout(240_000);
  const { popup: p } = await popup(SITE!);
  const nav = p.getByRole('navigation', { name: 'Report' });
  for (const [i, [group, page]] of PAGES.entries()) {
    await nav
      .getByRole('button', { name: new RegExp(`^${group}`) })
      .first()
      .click();
    if (page !== group) await nav.getByRole('button', { name: new RegExp(`^${page}`) }).click();
    await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
    await p.waitForTimeout(page === 'Accessibility' ? 8000 : 3000);
    const name = `${String(i + 1).padStart(2, '0')}-${page.toLowerCase().replace(/\W+/g, '-')}`;
    await p.screenshot({ path: `test-results/screens/${name}.png` });
    const height = await p.evaluate(() => document.querySelector('main')!.scrollHeight);
    if (height > 600) {
      // Let the report grow to its full height for one screenshot, then restore the popup size.
      const tag = await p.addStyleTag({
        content:
          'body,#app>div,aside{height:auto!important;min-height:600px}main{overflow:visible!important}',
      });
      // Chrome cannot capture taller than 16,384 px.
      await p.setViewportSize({ width: 800, height: Math.min(height + 40, 16_000) });
      await p.screenshot({ path: `test-results/screens/${name}-full.png`, fullPage: true });
      await tag.evaluate((t) => (t as HTMLElement).remove());
      await p.setViewportSize({ width: 800, height: 600 });
    }
  }
});
