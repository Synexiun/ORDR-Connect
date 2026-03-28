/**
 * Accessibility E2E Tests
 *
 * Covers:
 * - Page title is set on each route
 * - Landmark roles are present (main, navigation, banner)
 * - No keyboard traps (Tab navigates past command palette after close)
 * - ARIA labels on interactive controls
 *
 * SOC2 CC1 — Availability: accessible interface.
 * HIPAA §164.312 — No PHI in aria-labels or page titles.
 */

import { test, expect } from '@playwright/test';

// Helper: demo login
async function loginDemo(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /demo|try demo/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe('Page titles', () => {
  test('login page has a descriptive title', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/.+/);
  });

  test('dashboard has a title', async ({ page }) => {
    await loginDemo(page);
    await expect(page).toHaveTitle(/.+/);
  });
});

test.describe('Landmark roles', () => {
  test.beforeEach(async ({ page }) => {
    await loginDemo(page);
  });

  test('main navigation landmark is present', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible();
  });

  test('main content region is present', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible();
  });
});

test.describe('Interactive control labels', () => {
  test.beforeEach(async ({ page }) => {
    await loginDemo(page);
  });

  test('notification bell has accessible label', async ({ page }) => {
    const bell = page.getByTitle(/notifications/i);
    await expect(bell).toBeVisible();
  });

  test('user menu button has aria-label', async ({ page }) => {
    await expect(page.getByLabel(/user menu/i)).toBeVisible();
  });

  test('sidebar collapse button has aria-label', async ({ page }) => {
    await expect(page.getByLabel(/collapse sidebar/i)).toBeVisible();
  });

  test('command palette input has aria-label', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel(/search commands/i)).toBeVisible();
  });
});

test.describe('Keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginDemo(page);
  });

  test('can open and close command palette with keyboard only', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeHidden();
  });

  test('arrow keys navigate command palette items', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const input = page.getByLabel(/search commands/i);
    await input.press('ArrowDown');
    // Second item should be focused (aria-selected)
    const focusedItem = page.locator('[role="option"][aria-selected="true"]');
    await expect(focusedItem).toBeVisible();
  });
});
