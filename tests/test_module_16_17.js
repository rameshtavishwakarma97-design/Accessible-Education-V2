import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const STUDENT_EMAIL = 'maya.sharma@university.edu';
const TEACHER_EMAIL = 'anand.rao@university.edu';
const PASS = 'password123';

async function runModule16_17() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 16 & 17: ASSESSMENTS ---');

  // Login as Student
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', STUDENT_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard');

  // T16.1 — Assessments List
  await page.click('[data-testid="link-nav-assessments"]');
  await page.waitForURL('**/student/assessments');
  const assessments = page.locator('[data-testid^="card-assessment-"]');
  console.log(`T16.1 ✅ PASS — Assessments list loaded with ${await assessments.count()} cards`);
  await page.screenshot({ path: 'T16_1_student_assessments.png' });

  // Switch to Teacher for T17
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', TEACHER_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/teacher/dashboard');

  // T17.1 — Create Assessment (Check if possible from course detail)
  const courseCard = page.locator('[data-testid^="card-course-"]').first();
  await courseCard.click();
  await page.waitForURL('**/teacher/courses/**');
  await page.click('[data-testid="tab-assessments"]');
  const text = await page.textContent('main');
  console.log(`T17.1 — Assessments tab content: ${text.substring(0, 50)}...`);
  if (text.includes('management will be available here')) {
      console.log('T17.1 ⚠️ PARTIAL — Assessment creation is currently just a placeholder message');
  }

  await browser.close();
}

runModule16_17();
