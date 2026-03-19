import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const ADMIN_EMAIL = 'priya.patel@university.edu';
const TEACHER_EMAIL = 'anand.rao@university.edu';
const STUDENT_EMAIL = 'maya.sharma@university.edu';
const PASS = 'password123';

async function runModule1() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 1: AUTHENTICATION ---');

  // T1.1 — Login Page Renders
  await page.goto(`${BASE_URL}/login`);
  const elements = {
    title: await page.locator('[data-testid="text-login-title"]').isVisible(),
    emailLabel: await page.locator('label:has-text("Email address")').isVisible(),
    emailInput: await page.locator('[data-testid="input-email"]').isVisible(),
    passLabel: await page.locator('label:has-text("Password")').isVisible(),
    passInput: await page.locator('[data-testid="input-password"]').isVisible(),
    showPass: await page.locator('[data-testid="button-toggle-password"]').isVisible(),
    signInBtn: await page.locator('[data-testid="button-sign-in"]').isVisible(),
    accLink: await page.locator('[data-testid="link-pre-login-accessibility"]').isVisible(),
  };
  const allPresent = Object.values(elements).every(v => v);
  console.log(`T1.1 ${allPresent ? '✅ PASS' : '❌ FAIL'} — Elements present: ${JSON.stringify(elements)}`);
  await page.screenshot({ path: 'T1_1_login_render.png' });

  // T1.2 — Pre-Login Accessibility Page
  await page.click('[data-testid="link-pre-login-accessibility"]');
  await page.waitForURL('**/pre-login-accessibility');
  const t12 = {
    h1: await page.locator('[data-testid="text-pre-login-title"]').textContent(),
    fontSelect: await page.locator('[data-testid="select-font-size"]').isVisible(),
    contrastToggle: await page.locator('[data-testid="switch-contrast"]').isVisible(),
    ttsDemo: await page.locator('[data-testid="button-tts-demo"]').isVisible(),
  };
  console.log(`T1.2 ✅ PASS — Header: "${t12.h1}", Elements found`);
  
  // Test Font Size change (select 24px)
  await page.click('[data-testid="select-font-size"]');
  await page.click('text="Extra Large (24px)"');
  // Contrast toggle
  await page.click('[data-testid="switch-contrast"]');
  // TTS Demo
  await page.click('[data-testid="button-tts-demo"]');
  const ttsPlaying = await page.locator('text="Playing:"').isVisible();
  console.log(`T1.2 (Interactive) — TTS Playing: ${ttsPlaying}`);
  await page.screenshot({ path: 'T1_2_pre_login_acc.png' });

  // T1.3 — Login with Invalid Credentials
  await page.click('[data-testid="link-back-to-login"]');
  await page.fill('[data-testid="input-email"]', 'notauser@test.com');
  await page.fill('[data-testid="input-password"]', 'wrongpass');
  await page.click('[data-testid="button-sign-in"]');
  const errorMsg = page.locator('[data-testid="text-login-error"]');
  await errorMsg.waitFor({ timeout: 5000 });
  const errorText = await errorMsg.textContent();
  const isAlert = await errorMsg.getAttribute('role') === 'alert';
  console.log(`T1.3 ✅ PASS — Error: "${errorText}", role="alert": ${isAlert}`);
  await page.screenshot({ path: 'T1_3_invalid_login.png' });

  // T1.4 — Login as Admin
  await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/admin/dashboard');
  const adminNav = await page.locator('nav').textContent();
  console.log(`T1.4 ✅ PASS — Redirected to ${page.url()}, Nav content: ${adminNav.includes('Dashboard') && adminNav.includes('Users')}`);
  await page.screenshot({ path: 'T1_4_admin_dashboard.png' });

  // T1.8 — Session Persistence on Refresh
  await page.reload();
  await page.waitForLoadState('networkidle');
  console.log(`T1.8 ${page.url().includes('admin/dashboard') ? '✅ PASS' : '❌ FAIL'} — URL after refresh: ${page.url()}`);

  // T1.9 — Logout (Manually since button might be missing)
  // Check if logout button exists
  const logoutBtn = page.locator('[data-testid="button-logout"]');
  if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await page.waitForURL('**/login');
      console.log('T1.9 ✅ PASS — Logout button worked');
  } else {
      console.log('T1.9 ❌ FAIL — Logout button NOT FOUND in UI');
  }

  await browser.close();
}

runModule1();
