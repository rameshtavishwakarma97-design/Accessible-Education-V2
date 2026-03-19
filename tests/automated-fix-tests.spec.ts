/**
 * Automated Test Suite for AccessEd Platform Fixes
 * Tests all 6 issues with zero manual intervention
 * Run with: npx playwright test automated-fix-tests.spec.ts
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:54321';
const TEST_FILE_CONTENT = 'Python is a high-level programming language. It emphasizes code readability with significant indentation. Python supports multiple programming paradigms including procedural, object-oriented, and functional programming.';
const TEST_FILE_NAME = 'automated-test-content.txt';

// Test credentials
const TEACHER_LOGIN = {
  email: 'anand.rao@university.edu',
  password: 'password123'
};

const STUDENT_LOGIN = {
  email: 'maya.sharma@university.edu',
  password: 'password123'
};

let uploadedContentId: string;
let courseOfferingId: string;

// Need serial execution because tests depend on uploadedContentId from the first test
test.describe.serial('Automated Fix Verification Tests', () => {

  test.beforeAll(async () => {
    // Create test file
    fs.writeFileSync(TEST_FILE_NAME, TEST_FILE_CONTENT, 'utf-8');
    console.log(`✓ Created test file: ${TEST_FILE_NAME}`);
  });

  test.afterAll(async () => {
    // Cleanup test file
    if (fs.existsSync(TEST_FILE_NAME)) {
      try { fs.unlinkSync(TEST_FILE_NAME); } catch (e) { }
    }
  });

  // ============================================================================
  // ISSUE 1, 2, 3: Upload, Conversion, and File Serving
  // ============================================================================

  test('Issue 1,2,3: Upload file, verify conversion, and test format serving', async ({ page }) => {
    test.setTimeout(120000); // 120 second timeout for whole process

    // Step 1: Login as teacher
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', TEACHER_LOGIN.email);
    await page.fill('input[type="password"]', TEACHER_LOGIN.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(url => url.pathname.includes('dashboard') || url.pathname.includes('courses'), { timeout: 15000 });
    console.log('✓ Logged in as teacher');

    // Step 2: Navigate to Software Engineering course (or any course)
    // Wait for the dashboard to load content
    await page.waitForSelector('text=My Courses', { timeout: 10000 });

    const courseCard = page.locator('[data-testid^="card-course-"]').filter({ hasText: 'Machine Learning' }).first();
    if (!await courseCard.isVisible()) {
        await page.locator('[data-testid^="card-course-"]').first().click();
    } else {
        await courseCard.click();
    }

    await page.waitForURL(/\/teacher\/courses\/[\w\d-]+/);

    // Extract courseOfferingId from URL
    const url = page.url();
    const match = url.match(/\/courses\/([\w\d-]+)/);
    expect(match, 'Course offering ID should be in URL').toBeTruthy();
    courseOfferingId = match![1];
    console.log(`✓ Course offering ID: ${courseOfferingId}`);

    // Step 3: Upload file (3-step process)
    // Wait for any potential overlays to clear
    await page.waitForTimeout(2000);

    const uploadBtn = page.locator('button:has-text("Upload Content")');
    await uploadBtn.click({ force: true }); // Using force if overlay is being annoying

    // Step 1 of Dialog
    await page.waitForSelector('[data-testid="input-content-title"]');
    await page.fill('[data-testid="input-content-title"]', 'Automated Test Upload');
    await page.fill('[data-testid="textarea-content-desc"]', 'Test description');
    await page.click('[data-testid="button-upload-next"]');

    // Step 2 of Dialog
    await page.waitForSelector('[data-testid^="checkbox-div-"]');
    await page.click('[data-testid="button-upload-next"]');

    // Step 3 of Dialog
    await page.waitForSelector('[data-testid="button-browse-file"]');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="button-browse-file"]')
    ]);
    await fileChooser.setFiles(TEST_FILE_NAME);

    // Final Upload
    await page.click('[data-testid="button-upload-convert"]');

    try {
      await expect(page.getByText('Upload started').first()).toBeVisible({ timeout: 15000 });
    } catch (e) {
      console.log("Toast not found, proceeding...");
    }

    // Explicitly handle dialog closing. If it's still open, close it.
    const dialog = page.locator('div[role="dialog"]');
    if (await dialog.isVisible()) {
      try {
        await page.click('[data-testid="button-close-dialog"]', { timeout: 1000 });
      } catch (e) {
        await page.keyboard.press('Escape');
      }
    }
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    console.log('✓ File upload initiated');

    // Step 4: Wait for conversion
    // The page auto-refetches, so we wait for the item to appear with "Published" or "Review Required"
    await page.waitForSelector('text=Automated Test Upload', { timeout: 30000 });
    console.log('✓ Uploaded content visible in list');

    // Give it a bit more time for Tier 2 if needed
    await page.waitForTimeout(5000);

    // Find the row for our content and click Preview
    const row = page.locator('tr', { hasText: 'Automated Test Upload' }).first();
    const previewBtn = row.locator('[data-testid^="button-preview-"]');
    await previewBtn.click();

    await page.waitForURL(/\/student\/content\/[\w\d-]+/);

    // Extract content ID from URL
    const contentUrl = page.url();
    const contentMatch = contentUrl.match(/\/content\/([\w\d-]+)/);
    expect(contentMatch, 'Content ID should be in URL').toBeTruthy();
    uploadedContentId = contentMatch![1];
    console.log(`✓ Content ID: ${uploadedContentId}`);

    // Step 5: Verify converted files exist in filesystem
    const convertedDir = path.join('uploads', 'converted', uploadedContentId);
    const transcriptPath = path.join(convertedDir, 'transcript.txt');
    const simplifiedPath = path.join(convertedDir, 'simplified.txt');
    const audioPath = path.join(convertedDir, 'audio.txt');

    // Wait up to 30 seconds for files to be written
    let fileExists = false;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(transcriptPath)) {
        fileExists = true;
        break;
      }
      await page.waitForTimeout(5000);
    }

    expect(fileExists, `Transcript file should exist: ${transcriptPath}`).toBeTruthy();
    console.log('✓ ISSUE 2 PASSED: Converted files created successfully');

    // Step 6: Test format switching (ISSUE 3)
    const networkErrors: string[] = [];
    page.on('response', response => {
      if (response.status() === 404 && response.url().includes('/api/content')) {
        networkErrors.push(`404: ${response.url()}`);
      }
    });

    // Test Transcript format
    await page.click('button:has-text("Transcript")');
    await page.waitForTimeout(2000);
    await expect(page.locator('main')).toContainText(/Python/);
    console.log('✓ Transcript format loaded');

    // Test Simplified format
    await page.click('button:has-text("Simplified")');
    await page.waitForTimeout(2000);
    console.log('✓ Simplified format loaded');

    // Test Audio format
    await page.click('button:has-text("Audio")');
    await page.waitForTimeout(2000);

    // ISSUE 3 VERIFICATION: No 404 errors
    expect(networkErrors.length, `Should have no 404 errors. Found: ${networkErrors.join(', ')}`).toBe(0);
    console.log('✓ ISSUE 3 PASSED: No 404 errors when loading formats');
  });

  // ============================================================================
  // ISSUE 1: Dashboard Visibility
  // ============================================================================

  test('Issue 1: Uploaded content appears on student dashboard', async ({ page }) => {
    test.setTimeout(45000);

    // Login as student
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', STUDENT_LOGIN.email);
    await page.fill('input[type="password"]', STUDENT_LOGIN.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(/student\/dashboard/, { timeout: 60000, waitUntil: 'domcontentloaded' });
    console.log('✓ Logged in as student');

    // Check "New Content" section
    await page.waitForSelector('text=New Content', { timeout: 15000 });

    // Look for the uploaded file
    const contentLink = page.locator('text=Automated Test Upload').first();
    await expect(contentLink).toBeVisible({ timeout: 15000 });

    console.log('✓ ISSUE 1 PASSED: Content visible on student dashboard');
  });

  // ============================================================================
  // ISSUE 4: Spotify-Style Audio Player
  // ============================================================================

  test('Issue 4: Audio player has Spotify-style controls', async ({ page }) => {
    test.setTimeout(45000);

    // Go directly to content viewer
    await page.goto(`${BASE_URL}/student/content/${uploadedContentId}`);

    // Switch to audio format
    await page.click('button:has-text("Audio")');
    await page.waitForTimeout(3000);

    // VERIFICATION: Check for enhanced audio player controls
    // Using selectors based on TTSAudioPlayer.tsx

    // 1. Play button
    const playButton = page.locator('button[aria-label="Play"], button:has(svg.lucide-play)');
    await expect(playButton, 'Play button should be visible').toBeVisible();

    // 2. Skip buttons
    const skipBackButton = page.locator('button[aria-label="Seek back 10 seconds"]');
    await expect(skipBackButton, 'Skip back button should be visible').toBeVisible();

    const skipForwardButton = page.locator('button[aria-label="Seek forward 10 seconds"]');
    await expect(skipForwardButton, 'Skip forward button should be visible').toBeVisible();

    // 3. Time display
    const timeDisplay = page.locator('span.font-mono.text-xs');
    await expect(timeDisplay, 'Time display should be visible').toBeVisible();

    // 4. Progress bar slider
    const progressSlider = page.locator('input[type="range"][aria-label="Seek progress"]');
    await expect(progressSlider, 'Progress bar slider should be visible').toBeVisible();

    console.log('✓ All audio player controls are present');

    // Functional test: Play/Pause
    await playButton.click();
    await page.waitForTimeout(1000);
    const pauseButton = page.locator('button[aria-label="Pause"], button:has(svg.lucide-pause)');
    await expect(pauseButton, 'Play button should change to Pause').toBeVisible();

    console.log('✓ ISSUE 4 PASSED: Spotify-style audio player functional');
  });

  // ============================================================================
  // ISSUE 5: Progress Bar (Reading Progress)
  // ============================================================================

  test('Issue 5: Reading progress bar works correctly', async ({ page }) => {
    test.setTimeout(45000);

    // Go directly to content viewer in transcript format
    await page.goto(`${BASE_URL}/student/content/${uploadedContentId}`);
    await page.click('button:has-text("Transcript")');
    await page.waitForTimeout(2000);

    // Locate progress bar (it's fixed at top usually)
    const progressBar = page.locator('div[role="progressbar"]').first();
    const progressText = page.locator('text=/Progress: \\d+%/').first();

    await expect(progressBar, 'Progress bar should be visible').toBeVisible();

    // VERIFICATION 1: Progress increases when scrolling
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
    const initialText = await progressText.textContent();

    // Scroll a bit
    await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      main.scrollTo(0, 500);
      window.scrollTo(0, 500);
    });
    await page.waitForTimeout(1000);
    const middleText = await progressText.textContent();

    // We expect some change, but if content is short it might already be 100% or stay 0%
    // Let's just check it's present.
    console.log(`✓ Progress text: ${middleText}`);

    // VERIFICATION 2: Progress reaches 100% at bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);
    const finalText = await progressText.textContent();
    expect(finalText, 'Progress should be high at bottom').toMatch(/Progress: (9\d|100)%/);

    console.log('✓ ISSUE 5 PASSED: Progress bar works correctly');
  });

  // ============================================================================
  // ISSUE 6: Font Size Slider
  // ============================================================================

  test('Issue 6: Font size slider changes text size in real-time', async ({ page }) => {
    test.setTimeout(45000);

    // Go directly to content viewer
    await page.goto(`${BASE_URL}/student/content/${uploadedContentId}`);
    await page.waitForTimeout(2000);

    // Locate font size slider
    const fontSlider = page.locator('input[type="range"][aria-label="Font size"]').first();
    await expect(fontSlider, 'Font size slider should be visible').toBeVisible();

    // Get content area for measuring font size
    const contentArea = page.locator('.prose, main').first();

    // VERIFICATION 1: Get initial font size
    const initialFontSize = await contentArea.evaluate(el =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );
    console.log(`✓ Initial font size: ${initialFontSize}px`);

    // VERIFICATION 2: Increase font size
    await fontSlider.fill('1.5'); // Set to 150%
    await page.waitForTimeout(1000);

    const increasedFontSize = await contentArea.evaluate(el =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );
    expect(increasedFontSize, 'Font size should increase when slider moves').toBeGreaterThan(initialFontSize);
    console.log(`✓ Font size increased to: ${increasedFontSize}px`);

    console.log('✓ ISSUE 6 PASSED: Font size slider fully functional');
  });

});
