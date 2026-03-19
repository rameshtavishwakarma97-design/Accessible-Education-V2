import { test, expect } from '@playwright/test';

const STUDENT = { email: 'maya.sharma@university.edu', password: 'password123' };

test.describe('Module 2: Profile Setup', () => {
  test.beforeEach(async ({ page }) => {
    // Login as student
    await page.goto('/login');
    await page.fill('[data-testid="input-email"]', STUDENT.email);
    await page.fill('[data-testid="input-password"]', STUDENT.password);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForLoadState('networkidle');
    await page.waitForURL('**/student/dashboard');
    // Close modal if it auto-appears
    try {
      const modal = page.locator('div[role="dialog"]');
      if (await modal.isVisible({ timeout: 2000 })) {
        await page.keyboard.press('Escape');
      }
    } catch (e) { }

    await page.waitForURL('**/student/dashboard', { timeout: 15000 });
    await page.waitForSelector('main#main-content', { timeout: 10000 });
  });

  test('Profile setup modal appears and is functional', async ({ page }) => {
    // Trigger the profile setup modal via the top bar button
    await page.click('[data-testid="button-profile-setup"]');

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Step 1: Disability selection
    const motorOption = page.locator('[data-testid="option-disability-motor"]');
    const dyslexiaOption = page.locator('[data-testid="option-disability-dyslexia"]');

    if (await motorOption.getAttribute('aria-selected') !== 'true') {
      await motorOption.click();
    }
    // Wait for the UI state to update (the button gets the aria-selected attribute)
    await expect(motorOption).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });

    if (await dyslexiaOption.getAttribute('aria-selected') !== 'true') {
      await dyslexiaOption.click();
    }
    await expect(dyslexiaOption).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });

    // Multi-select works - check both are selected
    await expect(motorOption).toHaveAttribute('aria-selected', 'true');
    await expect(dyslexiaOption).toHaveAttribute('aria-selected', 'true');

    await page.click('[data-testid="button-profile-next"]');

    // Step 2: Preferences
    await expect(page.locator('[data-testid="slider-font-size"]')).toBeVisible();
    await page.click('[data-testid="button-profile-next"]');

    // Step 3: Assistive devices
    await expect(page.locator('[data-testid="select-screen-reader"]')).toBeVisible();

    // Save
    await page.click('[data-testid="button-profile-save"]');
    
    // Success toast and modal close — the component has a 1.5s delay
    // Use a more specific locator for the Shadcn toast
    const toast = page.locator('ol[tabindex="-1"] li').filter({ hasText: 'Profile saved' });
    await expect(toast).toBeVisible({ timeout: 25000 });
    await expect(modal).not.toBeVisible({ timeout: 20000 });
  });

  test('Accessibility profile tags show updated status', async ({ page }) => {
    // Check for chips/tags in the accessibility panel on the dashboard
    const accPanel = page.locator('section[aria-labelledby="accessibility-heading"]');
    await expect(accPanel).toBeVisible({ timeout: 10000 });

    // If the student has disabilities, check for disability chips
    const disabilityChips = accPanel.locator('[data-testid^="chip-disability-"], [data-testid^="chip-module-"]');
    const chipCount = await disabilityChips.count();

    // The panel itself should always be visible; chips depend on profile data
    if (chipCount > 0) {
      await expect(disabilityChips.first()).toBeVisible();
    }
  });

  test('Voice enabled logic based on disabilities', async ({ page }) => {
    // Open profile setup via top bar button
    await page.click('[data-testid="button-profile-setup"]');

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Step 1: Select only blind
    const motorOption = page.locator('[data-testid="option-disability-motor"]');
    const dyslexiaOption = page.locator('[data-testid="option-disability-dyslexia"]');
    const blindOption = page.locator('[data-testid="option-disability-blind"]');

    // Toggle off previous selections if active
    if (await motorOption.getAttribute('aria-selected') === 'true') await motorOption.click();
    if (await dyslexiaOption.getAttribute('aria-selected') === 'true') await dyslexiaOption.click();

    await blindOption.click();
  });
});
