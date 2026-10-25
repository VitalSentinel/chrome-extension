import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  // The site under test is a background tab (the popup has its own), where Chrome throttles
  // timers to once a second, so the analysis can take a few seconds on a busy machine.
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
