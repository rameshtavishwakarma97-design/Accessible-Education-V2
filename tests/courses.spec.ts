import { test, expect } from '@playwright/test';

const STUDENT = { email: 'maya.sharma@university.edu', password: 'password123' };

test.describe('Module 4: Courses', () => {
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

    // Wait for login to complete and auto-redirect to dashboard
    await page.waitForURL('**/student/dashboard', { timeout: 30000 });

    // Now navigate to courses
    await page.goto('/student/courses');
    await page.waitForURL('**/student/courses', { timeout: 30000 });

    // Ensure courses page is fully loaded
    await expect(page.locator('header', { hasText: 'My Courses' })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15000 });
  });

  test('Courses page lists all enrolled courses', async ({ page }) => {
    const courseCards = page.locator('[data-testid^="card-course-"]');
    const emptyState = page.getByText('No courses found');

    // Either course cards or empty state should be visible
    await expect(courseCards.first().or(emptyState)).toBeVisible({ timeout: 10000 });

    // Check for core/elective filters (always present)
    await expect(page.locator('[data-testid="button-filter-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-filter-core"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-filter-elective"]')).toBeVisible();
  });

  test('Clicking a course opens course detail', async ({ page }) => {
    const courseCards = page.locator('[data-testid^="card-course-"]');

    // Skip if no courses exist
    if (await courseCards.count() === 0) {
      test.skip(true, 'No enrolled courses to test');
      return;
    }

    const firstCourseCard = courseCards.first();
    const courseName = await firstCourseCard.locator('h3').textContent();

    await firstCourseCard.click();

    // Should navigate to course detail
    await expect(page).toHaveURL(/\/student\/courses\/[\w\d]+/, { timeout: 15000 });
    // Disambiguate h1 (one in TopBar, one in content)
    const contentH1 = page.locator('main h1');
    await expect(contentH1).toBeVisible();
    await expect(contentH1).not.toContainText('Loading...');
    await expect(contentH1).toContainText(courseName || '');
  });

  test('Course detail shows content list and navigates to viewer', async ({ page }) => {
    const courseCards = page.locator('[data-testid^="card-course-"]');

    // Skip if no courses exist
    if (await courseCards.count() === 0) {
      test.skip(true, 'No enrolled courses to test');
      return;
    }

    const firstCourseCard = courseCards.first();
    await firstCourseCard.click();

    // Switch to Content tab
    await page.click('[data-testid="tab-content"]');

    const contentLinks = page.locator('[data-testid^="link-content-"]');
    // If there is content, click the first one
    if (await contentLinks.count() > 0) {
      const firstContentLink = contentLinks.first();
      const contentTitle = await firstContentLink.textContent();

      await firstContentLink.click();

      // Should navigate to content viewer
      await expect(page).toHaveURL(/\/student\/content\/[\w\d]+/);
      // Content viewer might have a different title or header, but let's check for title
      await expect(page.locator('main')).toContainText(contentTitle || '');
    }
  });
});
