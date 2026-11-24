import { expect, test } from '@playwright/test';

test.describe('KHADMA V1.2 critical mobile user journeys', () => {
  test('renders Home with Employer, Job Seeker, Services cards and all-pill bottom nav', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.banner')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Je suis employeur' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Je cherche un emploi' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Services et prestataires' })).toBeVisible();

    const pills = page.locator('.bottom-nav .nav-item');
    await expect(pills).toHaveCount(5);
    await expect(page.locator('.bottom-nav .nav-item.active')).toHaveCount(1);
    await expect(page.locator('.bottom-nav .nav-item[aria-current="page"]')).toHaveCount(1);
  });

  test('navigates Job Seeker flow to /jobs with Oran-only neighborhoods and preserves category across FR/AR toggle', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Voir les offres d’emploi' }).click();
    await expect(page).toHaveURL(/\/jobs$/);

    const neighborhoodOptions = await page.locator('.filters select').nth(1).locator('option').allTextContents();
    expect(neighborhoodOptions).toContain('Bir El Djir');
    expect(neighborhoodOptions).toContain('Es Sénia');
    expect(neighborhoodOptions.join(' ')).not.toContain('Algiers');
    expect(neighborhoodOptions.join(' ')).not.toContain('Alger');

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
    expect(await page.evaluate(() => localStorage.getItem('khadma-lang'))).toBe('fr');
  });

  test('navigates Employer and Services entry points with locked listing types and keeps switcher on /post', async ({ page }) => {
    await page.goto('/employer');
    await expect(page.getByRole('heading', { name: 'Espace employeur' })).toBeVisible();
    await page.getByRole('link', { name: 'Publier une offre d’emploi' }).click();
    await expect(page).toHaveURL(/\/employer\/post$/);
    await expect(page.locator('.locked-type-row')).toHaveText('Offre d’emploi');
    await expect(page.locator('.type-switcher')).toHaveCount(0);

    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Services et prestataires' })).toBeVisible();
    await page.goto('/services/post');
    await expect(page.locator('.locked-type-row')).toHaveText('Service');
    await expect(page.locator('.type-switcher')).toHaveCount(0);

    await page.goto('/post');
    await expect(page.locator('.type-switcher')).toBeVisible();
    await expect(page.locator('.type-pill.active')).toHaveText('Offre d’emploi');

    await page.goto('/listings');
    await expect(page.getByRole('heading', { name: 'Toutes les annonces' })).toBeVisible();
  });

  test('shows safety banner and email-first registration (no SMS OTP) on /employer/post in FR and AR', async ({ page }) => {
    await page.goto('/employer/post');
    await expect(page.locator('.banner')).toBeVisible();
    // Ordinary SMS phone registration must be removed in V1.4 Phase 2
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);

    const emailInput = page.locator('input[type="email"]');
    const passInput = page.locator('input[type="password"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('dir', 'ltr');
    await expect(passInput).toBeVisible();

    // Invalid email triggers accessible alert via Enter key
    await emailInput.fill('not-an-email');
    await passInput.fill('short');
    await passInput.press('Enter');
    await expect(page.locator('.form-error[role="alert"]')).toBeVisible();

    // Switch to Login tab and Password Reset view
    await page.getByRole('tab', { name: 'Se connecter' }).click();
    await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
    await expect(page.getByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeVisible();

    // Switch to Arabic RTL and verify zero horizontal overflow on /employer/auth
    await page.goto('/employer/auth');
    await page.locator('.lang-toggle').getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'حساب صاحب العمل' })).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasOverflow).toBe(false);
  });

  test('renders saved empty state offline-first and admin login gate when unauthenticated', async ({ page }) => {
    await page.goto('/saved');
    await expect(page.locator('.empty')).toBeVisible();

    await page.goto('/admin');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('supports bounded search, active filter chips, and filter reset in French LTR and Arabic RTL', async ({ page }) => {
    await page.goto('/jobs');
    const searchInput = page.locator('#browse-search-input');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('peintre');
    await page.locator('.filters select').first().selectOption('construction');
    await expect(page.locator('.active-filters')).toBeVisible();
    await expect(page.locator('.active-filters-badge')).toContainText('2');
    await expect(page.locator('.filter-pill')).toHaveCount(2);

    // Clear search using the clear button
    await page.locator('.search-clear').click();
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('.filter-pill')).toHaveCount(1);

    // Switch to Arabic RTL and verify filter chip + reset works cleanly
    await page.locator('.lang-toggle').getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.active-filters')).toBeVisible();
    await page.locator('.active-filters .link-btn').click();
    await expect(page.locator('.active-filters')).toHaveCount(0);
  });
});
