import { EXTENSION_ID, expect, test } from './fixtures';
import { PAGES } from './pages';
import { ORIGIN } from './server';

test('loads with the pinned development ID', async ({ context }) => {
  expect(context.serviceWorkers()[0].url()).toContain(EXTENSION_ID);
});

test('every report page renders for a real page', async ({ popup }) => {
  const { popup: p } = await popup(`${ORIGIN}/page.html`);
  const nav = p.getByRole('navigation', { name: 'Report' });
  for (const [group, sub, heading] of PAGES) {
    await nav
      .getByRole('button', { name: new RegExp(`^${group}`) })
      .first()
      .click();
    if (sub !== group) await nav.getByRole('button', { name: new RegExp(`^${sub}`) }).click();
    await expect(p.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await p.screenshot({
      path: `test-results/popup-${heading.toLowerCase().replace(/\W+/g, '-')}.png`,
    });
  }
});

test('the accordion shows only the open group’s pages', async ({ popup }) => {
  const { popup: p } = await popup(`${ORIGIN}/page.html`);
  const nav = p.getByRole('navigation', { name: 'Report' });
  await nav.getByRole('button', { name: /^On-page/ }).click();
  await expect(nav.getByRole('button', { name: /^Social tags/ })).toBeVisible();
  await nav.getByRole('button', { name: /^Performance/ }).click();
  await expect(nav.getByRole('button', { name: /^Social tags/ })).toHaveCount(0);
});

test('Overview reads the page', async ({ popup }) => {
  const { popup: p } = await popup(`${ORIGIN}/page.html`);
  await expect(
    p.getByText('Trail Runner shoes – lightweight and grippy | Acme Store'),
  ).toBeVisible();
  await expect(p.getByText('Heading level skipped: H2 → H4')).toBeVisible();
});

test('crawlers page applies robots.txt', async ({ popup }) => {
  const { popup: p } = await popup(`${ORIGIN}/page.html`);
  const nav = p.getByRole('navigation', { name: 'Report' });
  await nav.getByRole('button', { name: /^Crawl and index/ }).click();
  await nav.getByRole('button', { name: /^Crawlers/ }).click();
  await expect(p.getByText('1 of 12 blocked for this URL')).toBeVisible();
  await expect(p.getByText('Disallow: /', { exact: true })).toBeVisible();
});

test('the JavaScript switch blocks scripts on the site and back', async ({ popup }) => {
  const { site, popup: p } = await popup(`${ORIGIN}/page.html`);
  await expect(site.locator('#js-marker')).toHaveText('JavaScript ran.');
  await p.getByRole('switch', { name: 'JavaScript on this site' }).click();
  await expect(site.locator('#js-marker')).toHaveText('JavaScript has not run.');
  await p.reload();
  await p.getByRole('switch', { name: 'JavaScript on this site' }).click();
  await expect(site.locator('#js-marker')).toHaveText('JavaScript ran.');
});

test('Show on page outlines the LCP element and survives reopening the popup', async ({
  popup,
}) => {
  const { site, popup: p } = await popup(`${ORIGIN}/page.html`);
  await p
    .getByRole('button', { name: /^Performance/ })
    .first()
    .click();
  const toggle = p.getByRole('switch', {
    name: 'Outline the LCP element and layout shifts on the page',
  });
  await toggle.click();
  await expect(p.getByText(/^LCP element outlined in purple/)).toBeVisible();
  await expect(site.locator('#vitalsentinel-overlay')).toHaveCount(1);
  await p.reload();
  await p
    .getByRole('button', { name: /^Performance/ })
    .first()
    .click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(site.locator('#vitalsentinel-overlay')).toHaveCount(0);
});

test('signed out, the VitalSentinel tab offers sign-in and the free plan', async ({ popup }) => {
  const { popup: p } = await popup(`${ORIGIN}/page.html`);
  await p.getByRole('button', { name: /^VitalSentinel/ }).click();
  await expect(p.getByRole('button', { name: 'Sign in with VitalSentinel' })).toBeVisible();
  await expect(p.getByText(/free for one domain/)).toBeVisible();
});

test('settings page saves a JavaScript rule', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
  await page
    .getByRole('textbox', { name: 'Host to block JavaScript on' })
    .fill('blocked.example.com');
  await page.getByRole('button', { name: 'Block JavaScript' }).click();
  await expect(page.getByText('blocked.example.com', { exact: true })).toBeVisible();
});
