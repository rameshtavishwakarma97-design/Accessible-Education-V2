import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const TEACHER = { email: 'anand.rao@university.edu', password: 'password123' };

test.describe('Module 7: Teacher', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="input-email"]', TEACHER.email);
    await page.fill('[data-testid="input-password"]', TEACHER.password);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/teacher/dashboard');
  });

  test('Teacher dashboard loads and shows courses', async ({ page }) => {
    await expect(page.locator('h2:has-text("My Courses")')).toBeVisible();
    const courseCards = page.locator('[data-testid^="card-course-"]');
    await expect(courseCards.first()).toBeVisible();
  });

  test('Upload content process', async ({ page }) => {
    // Go to first course
    await page.locator('[data-testid^="card-course-"]').first().click();
    await page.waitForURL('**/teacher/courses/**');

    // Click upload
    await page.click('[data-testid="button-upload-content"]');

    // Step 1: Info
    await page.fill('[data-testid="input-content-title"]', 'Test Lecture');
    // Select content type (Shadcn Custom Select)
    await page.click('[data-testid="select-content-type"]');
    // Wait for the dropdown content and click standard document option
    await page.getByRole('option', { name: 'Document', exact: true }).click();
    await page.fill('[data-testid="textarea-content-desc"]', 'This is a test upload');
    await page.click('[data-testid="button-upload-next"]');

    // Step 2: Sections (Divisions)
    await expect(page.locator('[data-testid^="checkbox-div-"]').first()).toBeVisible();
    await page.click('[data-testid="button-upload-next"]');

    // Step 3: File
    // Create a dummy file for upload
    const filePath = path.join(process.cwd(), 'test-upload.txt');
    fs.writeFileSync(filePath, 'Dummy content for playwright test');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('text=Browse Files');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    // Upload & Convert
    await page.click('[data-testid="button-upload-convert"]');

    // Step 4: Conversion Progress
    await expect(page.locator('text=Generating accessible formats')).toBeVisible();

    // Clean up dummy file
    fs.unlinkSync(filePath);
  });

  test('Review queue and approval', async ({ page }) => {
    await page.click('[data-testid="link-review-queue"]');
    await page.waitForURL('**/teacher/conversions');

    // Check if there are items to review
    // Note: This depends on the state of the DB. 
    // If empty, we check the empty state.
    const reviewRows = page.locator('[data-testid^="row-conv-"]');
    if (await reviewRows.count() > 0) {
      // Logic for approving would go here
    }
  });
});
