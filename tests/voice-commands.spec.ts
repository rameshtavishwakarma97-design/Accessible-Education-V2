import { test, expect } from '@playwright/test';

const STUDENT = { email: 'maya.sharma@university.edu', password: 'password123' };

test.describe('Module 6: Voice Commands', () => {
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
    } catch (e) {}

    await page.waitForURL('**/student/dashboard');
  });

  test('Mic button toggles between active and inactive on click', async ({ page }) => {
    // The VoiceCommandEngine is in a fixed div at bottom-right
    const micBtn = page.locator('button[aria-label^="Voice commands"]');
    await expect(micBtn).toBeVisible();

    // Initially it might be enabled or disabled based on profile
    const initialState = await micBtn.getAttribute('aria-label');
    
    await micBtn.click();
    const newState = await micBtn.getAttribute('aria-label');
    expect(newState).not.toBe(initialState);
    
    await micBtn.click();
    const finalState = await micBtn.getAttribute('aria-label');
    expect(finalState).toBe(initialState);
  });

  test('Voice engine mounting logic', async ({ page }) => {
    // This test verifies if the component is in the DOM.
    // In a real E2E, we'd need to change the user profile and reload.
    // For now, we'll verify it's there for a student who (presumably) has it enabled.
    const engine = page.locator('button[aria-label^="Voice commands"]');
    await expect(engine).toBeVisible();
  });
});
