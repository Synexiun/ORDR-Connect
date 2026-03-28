/**
 * Authentication Flow E2E Tests
 *
 * Covers:
 * - Landing page loads with CTA buttons
 * - Login page renders and accepts input
 * - Demo login bypasses credentials and lands on Dashboard
 * - Unauthenticated access to /dashboard redirects to /login
 *
 * SECURITY:
 * - No real credentials used (Rule 5)
 * - No PHI in any fixture (Rule 6)
 * - Demo mode uses ephemeral in-memory auth only
 */

import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('loads at / with page title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ORDR/i);
  });

  test('shows primary CTA', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByRole('link', { name: /get started|request demo|start free/i }).first();
    await expect(cta).toBeVisible();
  });

  test('has a link to /login', async ({ page }) => {
    await page.goto('/');
    const loginLink = page.getByRole('link', { name: /sign in|log in/i }).first();
    await expect(loginLink).toBeVisible();
  });
});

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders the login form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sign in|log in|welcome/i })).toBeVisible();
  });

  test('shows email input', async ({ page }) => {
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('shows password input', async ({ page }) => {
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('shows submit button', async ({ page }) => {
    const btn = page.getByRole('button', { name: /sign in|log in/i });
    await expect(btn).toBeVisible();
  });

  test('demo login button is present', async ({ page }) => {
    const demoBtn = page.getByRole('button', { name: /demo|try demo/i });
    await expect(demoBtn).toBeVisible();
  });
});

test.describe('Demo login flow', () => {
  test('clicking demo login lands on dashboard', async ({ page }) => {
    await page.goto('/login');
    const demoBtn = page.getByRole('button', { name: /demo|try demo/i });
    await demoBtn.click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('dashboard renders after demo login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /demo|try demo/i }).click();
    await page.waitForURL(/\/dashboard/);
    // Layout should be present
    await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible();
  });
});

test.describe('Auth guard', () => {
  test('visiting /dashboard unauthenticated redirects to /login', async ({ page }) => {
    // Fresh browser context with no stored auth
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('visiting /settings unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });
});
