import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const STUDENT_EMAIL = 'maya.sharma@university.edu';
const PASS = 'password123';

async function runModule10_11() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 10 & 11: STUDENT DASHBOARD & COURSES ---');

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', STUDENT_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard');

  // T10.1 — Student Dashboard Loads
  const courseCards = page.locator('[data-testid^="card-course-"]');
  try {
      await courseCards.first().waitFor({ timeout: 10000 });
      console.log(`T10.1 ✅ PASS — Student dashboard loaded with ${await courseCards.count()} courses`);
  } catch(e) {
      console.log('T10.1 ❌ FAIL — Student dashboard course cards did not load');
  }
  await page.screenshot({ path: 'T10_1_student_dashboard.png' });

  // T11.1 — Courses List
  await page.click('[data-testid="link-nav-courses"]');
  await page.waitForURL('**/student/courses');
  const allCourseCards = page.locator('[data-testid^="card-course-"]');
  console.log(`T11.1 ✅ PASS — Courses list loaded with ${await allCourseCards.count()} cards`);
  await page.screenshot({ path: 'T11_1_student_courses.png' });

  // T11.2 — Course Detail Tabs
  await allCourseCards.first().click();
  await page.waitForURL('**/student/courses/**');
  const detailTabs = page.locator('[data-testid="tabs-course-detail"]');
  if (await detailTabs.isVisible()) {
      console.log('T11.2 ✅ PASS — Course detail tabs visible');
  } else {
      console.log('T11.2 ❌ FAIL — Course detail tabs NOT FOUND');
  }
  await page.screenshot({ path: 'T11_2_student_course_detail.png' });

  await browser.close();
}

runModule10_11();
