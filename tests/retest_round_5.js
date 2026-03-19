import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const ADMIN = 'priya.patel@university.edu';
const PASS = 'password123';

async function runRound5() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- ROUND 5: NEW FEATURE FIXES ---');

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[data-testid="input-email"]', ADMIN);
    await page.fill('[data-testid="input-password"]', PASS);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/admin/dashboard');

    // 1. Logout button visibility
    const logoutBtn = page.locator('[data-testid="button-logout"]');
    console.log(`1. Logout button visible: ${await logoutBtn.isVisible() ? '✅ PASS' : '❌ FAIL'}`);

    // 2. Add User Modal
    await page.goto(`${BASE_URL}/admin/users`);
    await page.click('[data-testid="button-add-user"]');
    const modal = page.locator('role=dialog');
    console.log(`2. Add User modal opens: ${await modal.isVisible() ? '✅ PASS' : '❌ FAIL'}`);
    await page.keyboard.press('Escape');

    // 3. Auth Flicker (Basic check)
    await page.reload();
    await page.waitForLoadState('networkidle');
    const loginVisible = await page.locator('[data-testid="input-email"]').isVisible();
    console.log(`3. Auth Flicker (Stayed logged in): ${!loginVisible ? '✅ PASS' : '❌ FAIL'}`);

    // 4. Enrollment Dashboard
    await page.goto(`${BASE_URL}/admin/enrollment`);
    const tabs = page.locator('[data-testid="tabs-enrollment"]');
    console.log(`4. Enrollment tabs render: ${await tabs.isVisible() ? '✅ PASS' : '❌ FAIL'}`);

  } catch (e) {
    console.log(`❌ FAIL — Round 5 Error: ${e.message}`);
  }

  await browser.close();
}

runRound5();
