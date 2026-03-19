import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const TEACHER = 'anand.rao@university.edu';

async function runRound2() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- ROUND 2: UI AUTO-UPDATE VERIFICATION ---');

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[data-testid="input-email"]', TEACHER);
    await page.fill('[data-testid="input-password"]', PASS);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/teacher/dashboard');

    const courseCard = page.locator('[data-testid^="card-course-"]').first();
    await courseCard.click();
    await page.waitForURL('**/teacher/courses/**');

    const row = page.locator('tr:has-text("Retest Rules PDF")');
    const status = await row.locator('td').nth(3).textContent();
    console.log(`Round 2 Verification — Status in UI: ${status}`);
    
    // Check icons
    const formatsCell = row.locator('td').nth(2);
    const icons = await formatsCell.locator('div').count();
    console.log(`Round 2 Verification — Number of format icons visible: ${icons}`);

  } catch (e) {
    console.log(`❌ FAIL — Round 2 Error: ${e.message}`);
  }

  await browser.close();
}

runRound2();
