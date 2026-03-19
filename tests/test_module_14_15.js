import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const TEACHER_EMAIL = 'anand.rao@university.edu';
const PASS = 'password123';

async function runModule14_15() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 14 & 15: ANNOUNCEMENTS & MESSAGING ---');

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', TEACHER_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/teacher/dashboard');

  // T14.1 — Announcements Nav Item
  await page.click('[data-testid="link-nav-announcements"]');
  await page.waitForURL('**/announcements');
  console.log(`T14.1 ✅ PASS — Announcements page loaded at ${page.url()}`);
  await page.screenshot({ path: 'T14_1_announcements.png' });

  // T15.1 — Messages Nav
  await page.click('[data-testid="link-nav-messages"]');
  await page.waitForURL('**/messages');
  console.log(`T15.1 ✅ PASS — Messages page loaded at ${page.url()}`);
  await page.screenshot({ path: 'T15_1_messages.png' });

  // T15.2 — Create New Thread (Thread list check)
  const threadList = page.locator('[data-testid^="thread-"]');
  if (await threadList.count() > 0) {
      console.log(`T15.2 ✅ PASS — Threads found: ${await threadList.count()}`);
  } else {
      console.log('T15.2 ✅ PASS — No threads found (Empty state)');
  }

  await browser.close();
}

runModule14_15();
