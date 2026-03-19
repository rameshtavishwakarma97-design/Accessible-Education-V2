import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const STUDENT_EMAIL = 'maya.sharma@university.edu';

async function runTests() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- STUDENT TESTS ---');

  // Login
  await page.goto(BASE_URL + '/login');
  await page.fill('[data-testid="input-email"]', STUDENT_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard');

  // 7. Dashboard — does it show real courses and data?
  const courseCard = page.locator('[data-testid^="card-course-"]').first();
  await courseCard.waitFor({ timeout: 10000 });
  console.log(`7. Dashboard courses: ${await courseCard.isVisible() ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'student_7_dashboard.png' });

  // 8. Navigate to Courses — does list load?
  await page.click('[data-testid="link-nav-courses"]');
  await page.waitForURL('**/student/courses');
  const coursesList = page.locator('[data-testid^="card-course-"]');
  try {
      await coursesList.first().waitFor({ timeout: 10000 });
      console.log(`8. Courses list: WORKS (${await coursesList.count()} found)`);
  } catch (e) {
      console.log('8. Courses list: BROKEN (No courses appeared)');
  }
  await page.screenshot({ path: 'student_8_courses.png' });

  // 9. Open a course — do tabs (Content, Assessments, Messages) work?
  await coursesList.first().click();
  await page.waitForURL('**/student/courses/**');
  const tabs = page.locator('[data-testid="tabs-course-detail"]');
  try {
      await tabs.waitFor({ timeout: 10000 });
      console.log(`9. Course tabs: WORKS`);
  } catch (e) {
      console.log(`9. Course tabs: BROKEN`);
  }
  await page.screenshot({ path: 'student_9_course_detail.png' });

  // 10. Open a content item — does viewer load?
  await page.click('[data-testid="tab-content"]');
  const contentLink = page.locator('[data-testid^="link-content-"]');
  try {
      await contentLink.first().waitFor({ timeout: 10000 });
      console.log(`10. Content item found: WORKS`);
      await contentLink.first().click();
      await page.waitForURL('**/student/content/**');
      console.log(`10. Content viewer: WORKS`);
  } catch (e) {
      console.log('10. Content item: BROKEN');
  }
  await page.screenshot({ path: 'student_10_content_viewer.png' });

  // 11. Try switching content format (Audio, Braille, etc)
  const formatBtn = page.locator('[data-testid^="button-format-"]').first();
  if (await formatBtn.isVisible()) {
      await formatBtn.click();
      console.log('11. Switch format: WORKS');
  } else {
      console.log('11. Switch format: BROKEN (Buttons not found)');
  }
  await page.screenshot({ path: 'student_11_format_switch.png' });

  // 12-15. Assessments
  await page.click('[data-testid="link-nav-assessments"]');
  await page.waitForURL('**/student/assessments');
  const assessmentCard = page.locator('[data-testid^="card-assessment-"]');
  try {
      await assessmentCard.first().waitFor({ timeout: 10000 });
      console.log('12. Assessments list: WORKS');
      await assessmentCard.first().click();
      await page.waitForURL('**/student/assessments/**');
      console.log(`12. Start assessment: WORKS`);
  } catch (e) {
      console.log('12. Assessments: BROKEN');
  }
  await page.screenshot({ path: 'student_12_assessment_start.png' });

  // Answer a question
  const option = page.locator('button[role="option"]').first();
  if (await option.isVisible()) {
      await option.click();
      console.log('13. Answer question: WORKS');
  }

  // Save & Exit
  const saveBtn = page.locator('[data-testid="button-save-exit"]');
  if (await saveBtn.isVisible()) {
      await saveBtn.click();
      const confirmSave = page.locator('[data-testid="button-confirm-save"]');
      await confirmSave.waitFor({ timeout: 5000 });
      await confirmSave.click();
      await page.waitForURL('**/student/courses');
      console.log('13. Save & Exit: WORKS');
  } else {
      console.log('13. Save & Exit: BROKEN');
  }

  // 16-17. Messages
  await page.click('[data-testid="link-nav-messages"]');
  await page.waitForURL('**/messages');
  const thread = page.locator('[data-testid^="thread-"]').first();
  try {
      await thread.waitFor({ timeout: 10000 });
      console.log(`16. Messages load: WORKS`);
      await thread.click();
      await page.fill('[data-testid="textarea-message"]', 'Test message from Playwright');
      await page.click('[data-testid="button-send-message"]');
      console.log('17. Send message: WORKS');
  } catch (e) {
      console.log('16. Messages load: BROKEN');
  }
  await page.screenshot({ path: 'student_17_messages.png' });

  // 18. Announcements
  await page.click('[data-testid="link-nav-announcements"]');
  await page.waitForURL('**/announcements');
  const announcement = page.locator('[data-testid^="card-announcement-"]').first();
  try {
      await announcement.waitFor({ timeout: 10000 });
      console.log(`18. Announcements load: WORKS`);
  } catch (e) {
      console.log('18. Announcements load: BROKEN');
  }
  await page.screenshot({ path: 'student_18_announcements.png' });

  // 19-20. Accessibility Profile
  await page.click('[data-testid="link-profile"]');
  // It redirects to dashboard in App.tsx, but has a "Profile Setup" button in TopBar
  const setupBtn = page.locator('[data-testid="button-profile-setup"]');
  await setupBtn.click();
  const modal = page.locator('role=dialog');
  console.log(`19. Profile setup load: ${await modal.isVisible() ? 'WORKS' : 'BROKEN'}`);
  
  await page.click('[data-testid="button-profile-next"]'); // To step 2
  await page.click('[data-testid="switch-contrast-mode"]');
  await page.click('[data-testid="button-profile-next"]'); // To step 3
  await page.click('[data-testid="button-profile-save"]');
  console.log('20. Save profile: WORKS');
  await page.screenshot({ path: 'student_20_profile.png' });

  await browser.close();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
