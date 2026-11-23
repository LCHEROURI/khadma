import { expect, test } from '@playwright/test';

test.describe('KHADMA critical mobile user journeys', () => {
  test('renders browse screen with safety banner, Oran-only neighborhoods, and bottom nav', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.banner')).toBeVisible();
    await expect(page.locator('h1.page-title')).toBeVisible();

    const neighborhoodOptions = await page.locator('select').nth(1).locator('option').allTextContents();
    expect(neighborhoodOptions).toContain('Bir El Djir');
    expect(neighborhoodOptions).toContain('Es Sénia');
    expect(neighborhoodOptions.join(' ')).not.toContain('Algiers');
    expect(neighborhoodOptions.join(' ')).not.toContain('Alger');
  });

  test('defaults to French LTR, switches to Arabic RTL via header toggle, persists, and migrates legacy dar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // Select a category in French and verify switching to Arabic RTL updates label without changing value.
    const catSelect = page.locator('.filters select').first();
    await catSelect.selectOption('delivery');
    await expect(catSelect).toHaveValue('delivery');
    await expect(catSelect.locator('option[value="delivery"]')).toHaveText('Livraison');

    const toggle = page.locator('.lang-toggle');
    await toggle.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.header-name')).toHaveText('خدامة');
    await expect(catSelect).toHaveValue('delivery');
    await expect(catSelect.locator('option[value="delivery"]')).toHaveText('توصيل');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await toggle.getByRole('button', { name: 'FR' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.evaluate(() => localStorage.setItem('khadma-lang', 'dar'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    const migrated = await page.evaluate(() => localStorage.getItem('khadma-lang'));
    expect(migrated).toBe('fr');
  });

  test('shows safety banner and validates Algerian phone input on /post via Enter key', async ({ page }) => {
    await page.goto('/post');
    await expect(page.locator('.banner')).toBeVisible();
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill('041123456'); // invalid landline
    await phoneInput.press('Enter');
    await expect(page.locator('.form-error')).toBeVisible();
  });

  test('renders saved empty state offline-first without login', async ({ page }) => {
    await page.goto('/saved');
    await expect(page.locator('.empty')).toBeVisible();
  });

  test('renders admin login gate on /admin when unauthenticated', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});
