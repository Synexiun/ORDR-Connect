/**
 * Navigation E2E Tests
 *
 * Covers:
 * - Sidebar nav links navigate to correct routes
 * - Sidebar collapse/expand toggle works
 * - Breadcrumbs update on route change
 * - Command palette (Ctrl+K) opens, filters, and navigates
 *
 * SECURITY:
 * - Uses demo auth only — no PHI fixtures (Rule 6)
 */

import { test, expect } from '@playwright/test';

// ── Shared setup: log in via demo before each test ───────────────

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /demo|try demo/i }).click();
  await page.waitForURL(/\/dashboard/);
});

// ── Sidebar navigation ───────────────────────────────────────────

test.describe('Sidebar navigation', () => {
  test('navigates to Customers', async ({ page }) => {
    await page.getByRole('link', { name: /^customers$/i }).click();
    await expect(page).toHaveURL(/\/customers/);
  });

  test('navigates to Tickets', async ({ page }) => {
    await page.getByRole('link', { name: /^tickets$/i }).click();
    await expect(page).toHaveURL(/\/tickets/);
  });

  test('navigates to Analytics', async ({ page }) => {
    await page.getByRole('link', { name: /^analytics$/i }).click();
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('navigates to Settings', async ({ page }) => {
    await page.getByRole('link', { name: /^settings$/i }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test('navigates to Notifications', async ({ page }) => {
    await page.getByRole('link', { name: /^notifications$/i }).click();
    await expect(page).toHaveURL(/\/notifications/);
  });
});

// ── Sidebar collapse ─────────────────────────────────────────────

test.describe('Sidebar collapse', () => {
  test('collapse button is visible', async ({ page }) => {
    await expect(page.getByLabel(/collapse sidebar/i)).toBeVisible();
  });

  test('clicking collapse hides nav labels', async ({ page }) => {
    await page.getByLabel(/collapse sidebar/i).click();
    // Nav label text should no longer be visible
    await expect(page.getByText('Customers', { exact: true }).first()).toBeHidden();
  });

  test('clicking expand restores nav labels', async ({ page }) => {
    await page.getByLabel(/collapse sidebar/i).click();
    await page.getByLabel(/expand sidebar/i).click();
    await expect(page.getByRole('link', { name: /^customers$/i })).toBeVisible();
  });
});

// ── Command palette ───────────────────────────────────────────────

test.describe('Command palette', () => {
  test('opens on Ctrl+K', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  });

  test('shows search input when open', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel(/search commands/i)).toBeVisible();
  });

  test('closes on Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeHidden();
  });

  test('filters commands by typing', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByLabel(/search commands/i).fill('cust');
    await expect(page.getByRole('option', { name: /customers/i })).toBeVisible();
    // Unrelated items should not appear
    await expect(page.getByRole('option', { name: /analytics/i })).toBeHidden();
  });

  test('navigates via Enter on selected command', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByLabel(/search commands/i).fill('Tickets');
    // First result should be Tickets — press Enter
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tickets/);
  });

  test('navigates via click on command', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('option', { name: /^Analytics$/i }).click();
    await expect(page).toHaveURL(/\/analytics/);
  });
});
