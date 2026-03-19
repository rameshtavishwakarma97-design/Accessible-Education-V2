import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const STUDENT = 'maya.sharma@university.edu';

async function runRound3() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- ROUND 3: CONTENT VIEWER VERIFICATION ---');

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[data-testid="input-email"]', STUDENT);
    await page.fill('[data-testid="input-password"]', PASS);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/student/dashboard');

    await page.goto(`${BASE_URL}/student/courses/co1`); 
    await page.click('[data-testid="tab-content"]');
    
    await page.waitForLoadState('networkidle');
    const itemLink = page.locator('span:has-text("Retest Rules PDF")').first();
    await itemLink.click();
    await page.waitForURL('**/student/content/**');

    // 4. Switch to Transcript
    await page.click('[data-testid="select-format"]');
    await page.click('role=option[name="Transcript"]');
    await page.waitForTimeout(2000);
    const transcriptText = await page.locator('pre').textContent();
    console.log(`4. Transcript Content: "${transcriptText?.substring(0, 100)}..."`);
    console.log(`4. Transcript Result: ${transcriptText?.includes('REAL EXTRACTED') ? '✅ PASS' : '❌ FAIL'}`);

    // 5. Switch to Simplified
    await page.click('[data-testid="select-format"]');
    await page.click('role=option[name="Simplified"]');
    await page.waitForTimeout(2000);
    const simplifiedText = await page.locator('.simplified-content').textContent();
    console.log(`5. Simplified Content: "${simplifiedText?.substring(0, 100)}..."`);
    console.log(`5. Simplified Result: ${simplifiedText?.includes('SIMPLIFIED SUMMARY') ? '✅ PASS' : '❌ FAIL'}`);

  } catch (e) {
    console.log(`❌ FAIL — Round 3 Error: ${e.message}`);
  }

  await browser.close();
}

runRound3();
