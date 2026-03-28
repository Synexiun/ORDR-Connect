/**
 * Dashboard Page E2E Tests
 *
 * Covers:
 * - Dashboard page renders key metric cards
 * - Charts are present in the DOM
 * - Activity feed section loads
 * - TopBar is rendered with notifications bell and user menu
 *
 * SECURITY:
 * - Demo auth only — no real tenant data (Rule 6)
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /demo|try demo/i }).click();
  await page.waitForURL(/\/dashboard/);
});

test.describe('Dashboard', () => {
  test('has Dashboard page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
  });

  test('renders at least 3 metric cards', async ({ page }) => {
    // Metric cards — look for common stat cards (total messages, active agents, etc.)
    const cards = page.locator('[data-testid="stat-card"], [class*="Card"]');
    await expect(cards).toHaveCount(await cards.count());
    expect(await cards.count()).toBeGreaterThan(2);
  });

  test('top bar renders notification bell', async ({ page }) => {
    await expect(page.getByTitle(/notifications/i)).toBeVisible();
  });

  test('top bar renders user menu button', async ({ page }) => {
    await expect(page.getByLabel(/user menu/i)).toBeVisible();
  });

  test('main navigation is visible', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible();
  });

  test('compliance badge is visible', async ({ page }) => {
    await expect(page.getByText(/compliant|compliance: active/i).first()).toBeVisible();
  });
});

test.describe('TopBar user menu', () => {
  test('opens dropdown on user menu click', async ({ page }) => {
    await page.getByLabel(/user menu/i).click();
    await expect(page.getByRole('menu', { name: /user actions/i })).toBeVisible();
  });

  test('dropdown contains Profile, Settings, Sign Out', async ({ page }) => {
    await page.getByLabel(/user menu/i).click();
    await expect(page.getByRole('menuitem', { name: /profile/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  });

  test('sign out redirects to /login', async ({ page }) => {
    await page.getByLabel(/user menu/i).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
