import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';

async function runTests() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- AUTH TESTS ---');

  // 1. Open login page
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  const loginHeader = await page.locator('[data-testid="text-login-title"]').isVisible();
  console.log(`1. Login page appears: ${loginHeader ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'auth_1_login_page.png' });

  // 2. Login with wrong password
  await page.fill('[data-testid="input-email"]', 'maya.sharma@university.edu');
  await page.fill('[data-testid="input-password"]', 'wrongpass');
  await page.click('[data-testid="button-sign-in"]');
  // Wait for error message
  const errorMsg = page.locator('[data-testid="text-login-error"]');
  try {
    await errorMsg.waitFor({ timeout: 5000 });
    const text = await errorMsg.textContent();
    console.log(`2. Error message shows: WORKS (Msg: ${text})`);
  } catch (e) {
    console.log('2. Error message shows: BROKEN');
  }
  await page.screenshot({ path: 'auth_2_wrong_password.png' });

  // 3. Login as student
  await page.fill('[data-testid="input-email"]', 'maya.sharma@university.edu');
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard', { timeout: 15000 });
  console.log(`3. Student redirect: ${page.url().includes('student/dashboard') ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'auth_3_student_dashboard.png' });

  // 4. Logout
  const logoutBtn = page.locator('button:has-text("Log out"), button:has-text("Logout"), [data-testid="button-logout"]').first();
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
    await page.waitForURL('**/login', { timeout: 10000 });
    console.log('4. Logout: WORKS');
  } else {
    // Try sidebar logout if topbar doesn't have it
    const sidebarLogout = page.locator('nav >> text=Logout').first();
    if (await sidebarLogout.isVisible()) {
        await sidebarLogout.click();
        await page.waitForURL('**/login', { timeout: 10000 });
        console.log('4. Logout (sidebar): WORKS');
    } else {
        console.log('4. Logout button: NOT FOUND');
    }
  }
  await page.screenshot({ path: 'auth_4_logout.png' });

  // 5. Login as teacher
  await page.fill('[data-testid="input-email"]', 'anand.rao@university.edu');
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/teacher/dashboard', { timeout: 15000 });
  console.log(`5. Teacher redirect: ${page.url().includes('teacher/dashboard') ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'auth_5_teacher_dashboard.png' });

  // Logout for next test
  try {
     const nextLogout = page.locator('button:has-text("Log out"), button:has-text("Logout"), [data-testid="button-logout"], nav >> text=Logout').first();
     await nextLogout.click();
     await page.waitForURL('**/login');
  } catch(e) {}

  // 6. Login as admin
  await page.fill('[data-testid="input-email"]', 'priya.patel@university.edu');
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  console.log(`6. Admin redirect: ${page.url().includes('admin/dashboard') ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'auth_6_admin_dashboard.png' });

  await browser.close();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
