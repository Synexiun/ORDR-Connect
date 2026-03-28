/**
 * Playwright E2E Configuration
 *
 * Tests run against the Vite preview server (built SPA).
 * All tests use a demo/mock auth context — no real credentials required.
 *
 * SOC2 CC7.2 — System monitoring: end-to-end functional verification.
 * HIPAA §164.312 — No PHI used in any test fixture or assertion.
 *
 * Running locally:
 *   pnpm exec playwright install --with-deps chromium
 *   pnpm e2e                    # headless
 *   pnpm e2e --headed           # with browser visible
 *   pnpm e2e --ui               # interactive Playwright UI
 *
 * CI: runs headlessly in GitHub Actions (ubuntu-latest).
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 2 : 0,
  workers: process.env['CI'] !== undefined ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Security: no credentials stored in browser storage between tests
    storageState: undefined,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Spin up the Vite preview server before tests run.
  // Build must exist (run `pnpm build` in apps/web first).
  webServer: {
    command: 'pnpm --filter @ordr/web preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
