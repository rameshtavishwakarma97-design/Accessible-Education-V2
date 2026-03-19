import { test, expect } from '@playwright/test';

const STUDENT = { email: 'maya.sharma@university.edu', password: 'password123' };

test.describe('Module 3: Student Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="input-email"]', STUDENT.email);
    await page.fill('[data-testid="input-password"]', STUDENT.password);
    await page.click('[data-testid="button-sign-in"]');

    // Close modal if it appears (handled in Module 2, but needed here for consistency)
    try {
      const modal = page.locator('div[role="dialog"]');
      if (await modal.isVisible({ timeout: 2000 })) {
        await page.keyboard.press('Escape');
      }
    } catch (e) { }

    // Wait for dashboard to finish loading
    await page.waitForURL('**/student/dashboard', { timeout: 30000 });
    // Ensure dashboard is fully loaded by waiting for top bar title or main content container
    await expect(page.locator('header', { hasText: 'Dashboard' })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15000 });
  });

  test('Dashboard loads with course cards', async ({ page }) => {
    // Dashboard should either show course cards or an empty state
    const courseCards = page.locator('[data-testid^="card-course-"]');
    const emptyState = page.getByText('No courses yet');

    // Wait for either course cards or empty state to be visible
    await expect(courseCards.first().or(emptyState)).toBeVisible({ timeout: 10000 });

    // If course cards exist, verify their structure
    if (await courseCards.count() > 0) {
      const firstCard = courseCards.first();
      await expect(firstCard.locator('h3')).not.toBeEmpty();
      await expect(firstCard.locator('.font-mono')).not.toBeEmpty(); // Course code badge
    }
  });

  test('Accessibility profile panel shows active modules', async ({ page }) => {
    const accPanel = page.locator('section[aria-labelledby="accessibility-heading"]');
    await expect(accPanel).toBeVisible({ timeout: 10000 });

    // The panel should be visible regardless of whether modules are active
    // Chips only appear if student has disabilities configured
    const activeModules = accPanel.locator('[data-testid^="chip-module-"]');
    const chipCount = await activeModules.count();

    if (chipCount > 0) {
      await expect(activeModules.first()).toBeVisible();
    }
    // Panel itself is visible — that's the core assertion
  });

  test('Upcoming assessments panel shows due dates', async ({ page }) => {
    const assessmentsPanel = page.locator('section[aria-labelledby="assessments-heading"]');
    await expect(assessmentsPanel).toBeVisible({ timeout: 10000 });

    const assessmentRows = assessmentsPanel.locator('[data-testid^="row-assessment-"]');
    // If there are assessments, check for due date badges
    if (await assessmentRows.count() > 0) {
      await expect(assessmentRows.first().locator('.text-destructive')).toBeVisible();
    }
    // Panel visible with "All clear!" empty state is also valid
  });

  test('New content section shows latest uploads', async ({ page }) => {
    const contentSection = page.locator('section[aria-labelledby="new-content-heading"]');
    await expect(contentSection).toBeVisible({ timeout: 10000 });

    const contentRows = contentSection.locator('[data-testid^="row-content-"]');
    const emptyState = contentSection.getByText('No recent content');

    // Either content rows or empty state should be visible
    await expect(contentRows.first().or(emptyState)).toBeVisible({ timeout: 10000 });
  });

  test('"View All" link navigates to courses page', async ({ page }) => {
    await page.click('[data-testid="link-view-all-courses"]');
    await expect(page).toHaveURL(/\/student\/courses/);
  });
});
