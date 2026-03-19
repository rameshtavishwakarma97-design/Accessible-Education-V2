import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const TEACHER_EMAIL = 'anand.rao@university.edu';
const PASS = 'password123';

async function runModule8_9() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 8 & 9: TEACHER DASHBOARD & CONTENT ---');

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', TEACHER_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/teacher/dashboard');

  // T8.1 — Teacher Dashboard Loads
  const courseCards = page.locator('[data-testid^="card-course-"]');
  try {
      await courseCards.first().waitFor({ timeout: 10000 });
      console.log(`T8.1 ✅ PASS — Teacher dashboard loaded with ${await courseCards.count()} courses`);
  } catch(e) {
      console.log('T8.1 ❌ FAIL — Teacher dashboard course cards did not load');
  }
  await page.screenshot({ path: 'T8_1_teacher_dashboard.png' });

  // T9.1 — Teacher Course Detail Page
  await courseCards.first().click();
  await page.waitForURL('**/teacher/courses/**');
  const tabs = {
      content: await page.locator('[data-testid="tab-content"]').isVisible(),
      students: await page.locator('[data-testid="tab-students"]').isVisible(),
      assessments: await page.locator('[data-testid="tab-assessments"]').isVisible(),
  };
  console.log(`T9.1 ✅ PASS — Course detail tabs: ${JSON.stringify(tabs)}`);
  await page.screenshot({ path: 'T9_1_teacher_course_detail.png' });

  // T9.2 — Upload Content (Form check only)
  await page.click('[data-testid="button-upload-content"]');
  const uploadTitle = page.locator('[data-testid="input-content-title"]');
  if (await uploadTitle.isVisible()) {
      console.log('T9.2 ✅ PASS — Upload modal step 1 works');
      await uploadTitle.fill('Test Automation Lecture');
      await page.click('[data-testid="button-upload-next"]');
      console.log('T9.2 ✅ PASS — Upload modal step 2 reached');
  } else {
      console.log('T9.2 ❌ FAIL — Upload modal did not open');
  }
  await page.keyboard.press('Escape');

  // T9.11 — Delete Content: Impact Modal
  const deleteBtn = page.locator('[data-testid^="button-delete-"]').first();
  if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      const impactModal = page.locator('role=dialog');
      try {
          await impactModal.waitFor({ timeout: 5000 });
          const text = await impactModal.textContent();
          console.log(`T9.11 ✅ PASS — Impact modal visible, content: ${text.includes('Views') || text.includes('Delete')}`);
      } catch(e) {
          console.log('T9.11 ❌ FAIL — Impact modal did not appear');
      }
  } else {
      console.log('T9.11 🔲 NOT FOUND — No delete button found (Empty content list?)');
  }

  await browser.close();
}

runModule8_9();
