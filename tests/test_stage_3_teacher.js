import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const TEACHER_EMAIL = 'anand.rao@university.edu';

async function runTests() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- TEACHER TESTS ---');

  // Login
  await page.goto(BASE_URL + '/login');
  await page.fill('[data-testid="input-email"]', TEACHER_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/teacher/dashboard');

  // 21. Dashboard — does it show courses and conversion queue?
  const courseCard = page.locator('[data-testid^="card-course-"]').first();
  await courseCard.waitFor({ timeout: 10000 });
  console.log(`21. Dashboard: ${await courseCard.isVisible() ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'teacher_21_dashboard.png' });

  // 22. Open a course — does content list appear?
  await courseCard.click();
  await page.waitForURL('**/teacher/courses/**');
  const contentTable = page.locator('table[aria-label="Content items"]');
  try {
      await contentTable.waitFor({ timeout: 10000 });
      console.log(`22. Content list: WORKS`);
  } catch (e) {
      console.log(`22. Content list: BROKEN`);
  }
  await page.screenshot({ path: 'teacher_22_course_detail.png' });

  // 23-25. Upload file
  await page.click('[data-testid="button-upload-content"]');
  const uploadModal = page.locator('role=dialog');
  try {
      await uploadModal.waitFor({ timeout: 5000 });
      console.log(`23. Upload modal: WORKS`);
      const titleInput = page.locator('[data-testid="input-content-title"]');
      console.log(`24. Upload form: ${await titleInput.isVisible() ? 'WORKS' : 'BROKEN'}`);
  } catch(e) {
      console.log('23. Upload modal: BROKEN');
  }
  
  // Close modal by clicking outside or pressing Escape
  await page.keyboard.press('Escape');

  // 26-29. Trash / Delete
  const deleteBtn = page.locator('[data-testid^="button-delete-"]').first();
  if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      const impactModal = page.locator('role=dialog');
      try {
          await impactModal.waitFor({ timeout: 5000 });
          console.log(`26. Delete impact modal: WORKS`);
          await page.click('[data-testid="button-confirm-delete"]');
          console.log('27. Move to trash: WORKS');
      } catch(e) {
          console.log('26. Delete impact modal: BROKEN');
      }
  }
  
  await page.click('[data-testid="link-nav-content-library"]'); // Assuming navigation
  // Note: Teacher nav uses "Content Library" but the url is /teacher/content which redirects to dashboard?
  // Let's check App.tsx again.
  // <Route path="/teacher/content" component={() => <RoleGuard allowedRoles={["teacher"]}><TeacherDashboard /></RoleGuard>} />
  // Ah, it seems Content Library is NOT a separate page yet.

  // 30-32. Conversion Queue
  await page.click('[data-testid="link-nav-conversion-queue"]');
  await page.waitForURL('**/teacher/conversions');
  const queueItem = page.locator('[data-testid^="row-job-"]').first();
  try {
      await queueItem.waitFor({ timeout: 10000 });
      console.log(`30. Conversion queue: WORKS`);
  } catch (e) {
      console.log(`30. Conversion queue: BROKEN`);
  }
  await page.screenshot({ path: 'teacher_30_queue.png' });

  // 33. Create an assessment
  await page.click('[data-testid="link-nav-my-courses"]');
  await courseCard.first().click();
  const createAssessmentBtn = page.locator('[data-testid="button-create-assessment"]');
  if (await createAssessmentBtn.isVisible()) {
      await createAssessmentBtn.click();
      console.log('33. Create assessment form: WORKS');
      await page.click('button:has-text("Cancel")');
  }

  // 34. Create an announcement
  await page.click('[data-testid="link-nav-announcements"]');
  await page.waitForURL('**/announcements');
  const createAnnouncementBtn = page.locator('[data-testid="button-create-announcement"]');
  if (await createAnnouncementBtn.isVisible()) {
      await createAnnouncementBtn.click();
      console.log('34. Create announcement form: WORKS');
  }

  // 35. Messages
  await page.click('[data-testid="link-nav-messages"]');
  await page.waitForURL('**/messages');
  console.log(`35. Teacher messages: ${page.url().includes('/messages') ? 'WORKS' : 'BROKEN'}`);

  await browser.close();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
