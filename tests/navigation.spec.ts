import { test, expect } from '@playwright/test';

const STUDENT = { email: 'maya.sharma@university.edu', password: 'password123' };

test.describe('Module 6: Navigation', () => {
  // We need to keep the session alive across navigations for the back button test
  test.use({ storageState: { cookies: [], origins: [] } });

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

    await page.waitForURL('**/student/dashboard', { timeout: 30000 });
    // Ensure dashboard is fully loaded
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15000 });
  });

  test('Sidebar navigation links all navigate correctly', async ({ page }) => {
    // If on mobile, open sidebar first
    const sidebarToggle = page.locator('[data-testid="button-sidebar-toggle"]');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
    }

    // Test navigation to Courses
    const navCourses = page.locator('[data-testid="link-nav-courses"]');
    await expect(navCourses).toBeVisible({ timeout: 10000 });
    // Force click to bypass any sidebar animation or offscreen issues on mobile viewports
    await navCourses.click({ force: true });
    await expect(page).toHaveURL(/\/student\/courses/, { timeout: 15000 });

    // Re-open sidebar if needed
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
    }

    // Test navigation back to Dashboard
    const navDashboard = page.locator('[data-testid="link-nav-dashboard"]');
    await expect(navDashboard).toBeVisible({ timeout: 10000 });
    await navDashboard.click({ force: true });
    await expect(page).toHaveURL(/\/student\/dashboard/, { timeout: 15000 });
  });

  test('Browser back button works correctly', async ({ page, context }) => {
    // Navigate to courses via UI
    const sidebarToggle = page.locator('[data-testid="button-sidebar-toggle"]');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click({ force: true });
    }
    await page.click('[data-testid="link-nav-courses"]', { force: true });
    await expect(page).toHaveURL(/\/student\/courses/, { timeout: 15000 });

    // Wait a brief moment to ensure history is registered
    await page.waitForTimeout(500);

    // Click browser back button
    await page.goBack();

    // Should return to dashboard without losing session
    await expect(page).toHaveURL(/\/student\/dashboard/);
    await expect(page.locator('main#main-content')).toBeVisible({ timeout: 10000 });
  });
});
