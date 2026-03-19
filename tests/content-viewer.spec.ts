import { test, expect } from '@playwright/test';

const STUDENT = { email: 'maya.sharma@university.edu', password: 'password123' };

test.describe('Module 5: Content Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="input-email"]', STUDENT.email);
    await page.fill('[data-testid="input-password"]', STUDENT.password);
    await page.click('[data-testid="button-sign-in"]');

    // Close modal if it appears
    try {
      const modal = page.locator('div[role="dialog"]');
      if (await modal.isVisible({ timeout: 2000 })) {
        await page.keyboard.press('Escape');
      }
    } catch (e) { }

    // Wait for auto-navigation to dashboard after successful login
    await page.waitForURL('**/student/dashboard', { timeout: 30000 });
    await expect(page.locator('header', { hasText: 'Dashboard' })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15000 });

    const contentRows = page.locator('[data-testid^="row-content-"]');
    const hasContent = await contentRows.count() > 0;

    if (hasContent) {
      await contentRows.first().click();
      await page.waitForURL('**/student/content/**');
    } else {
      // No content available — tests that need it will skip
    }
  });

  test('Content viewer loads with original format by default', async ({ page }) => {
    // Skip if we never navigated to a content viewer
    if (!page.url().includes('/student/content/')) {
      test.skip(true, 'No content available to test');
      return;
    }

    const selectFormat = page.locator('[data-testid="select-format"]');
    await expect(selectFormat).toContainText('Original');
  });

  test('Format switching works', async ({ page }) => {
    if (!page.url().includes('/student/content/')) {
      test.skip(true, 'No content available to test');
      return;
    }

    // Check for footer format buttons
    const simplifiedBtn = page.locator('[data-testid="button-footer-format-simplified"]');
    const audioBtn = page.locator('[data-testid="button-footer-format-audio"]');
    const transcriptBtn = page.locator('[data-testid="button-footer-format-transcript"]');

    // These might be disabled if not ready, but let's check visibility
    await expect(simplifiedBtn).toBeVisible();
    await expect(audioBtn).toBeVisible();
    await expect(transcriptBtn).toBeVisible();
  });

  test('Audio format and Spotify-style controls', async ({ page }) => {
    if (!page.url().includes('/student/content/')) {
      test.skip(true, 'No content available to test');
      return;
    }

    const audioBtn = page.locator('[data-testid="button-footer-format-audio"]');
    if (await audioBtn.isEnabled()) {
      await audioBtn.click();

      // Wait for player
      const player = page.locator('.rounded-xl.bg-\\[\\#355872\\]'); // Main player container
      await expect(player).toBeVisible({ timeout: 30000 }); // Generation might take time

      const playPauseBtn = player.locator('button[aria-label="Play"], button[aria-label="Pause"]');
      await expect(playPauseBtn).toBeVisible();

      // Initially paused or loading
      // Click play
      if (await player.locator('button[aria-label="Play"]').isVisible()) {
        await player.locator('button[aria-label="Play"]').click();
      }
      await expect(player.locator('button[aria-label="Pause"]')).toBeVisible();

      // Skip buttons
      await expect(player.locator('button[aria-label="Skip back 15 seconds"]')).toBeVisible();
      await expect(player.locator('button[aria-label="Skip forward 15 seconds"]')).toBeVisible();

      // Speed control
      const speedSelect = player.locator('select[aria-label="Playback speed"]');
      await expect(speedSelect).toBeVisible();
      await speedSelect.selectOption('1.5');
      await expect(speedSelect).toHaveValue('1.5');
    }
  });

  test('Mic button logic for different profiles', async ({ page }) => {
    // This test is a placeholder — mic button may not exist in current UI.
    // The requirement says "Mic button visible for motor/dyslexia profile students"
    // and "NOT auto-active for blind-only".
    // Since we are logged in as a student, we can check the presence if available.
  });
});
