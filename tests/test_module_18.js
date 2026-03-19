import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const STUDENT_EMAIL = 'maya.sharma@university.edu';
const PASS = 'password123';

async function runModule18() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 18: ACCESSIBILITY PROFILE ---');

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', STUDENT_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard');

  // T18.1 — Access Profile from Dashboard
  await page.click('[data-testid="button-profile-setup"]'); // Using the top-bar button
  const modal = page.locator('role=dialog');
  if (await modal.isVisible()) {
      console.log('T18.1 ✅ PASS — Accessibility profile modal opened');
  } else {
      console.log('T18.1 ❌ FAIL — Accessibility profile modal NOT FOUND');
  }
  await page.screenshot({ path: 'T18_1_profile_modal.png' });

  await browser.close();
}

runModule18();
