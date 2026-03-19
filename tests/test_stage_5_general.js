import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';

async function runTests() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- GENERAL CHECKS ---');

  // 50. Student access admin
  await page.goto(BASE_URL + '/login');
  await page.fill('[data-testid="input-email"]', 'maya.sharma@university.edu');
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard');
  
  await page.goto(BASE_URL + '/admin/dashboard');
  await page.waitForTimeout(2000);
  console.log(`50. Student access /admin redirect: ${page.url().includes('/login') ? 'WORKS' : 'BROKEN'} (URL: ${page.url()})`);

  // 51. Teacher access student
  // Manual "logout" by going to login and filling teacher creds
  await page.goto(BASE_URL + '/login');
  await page.fill('[data-testid="input-email"]', 'anand.rao@university.edu');
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/teacher/dashboard');
  
  await page.goto(BASE_URL + '/student/dashboard');
  await page.waitForTimeout(2000);
  console.log(`51. Teacher access /student redirect: ${page.url().includes('/login') ? 'WORKS' : 'BROKEN'} (URL: ${page.url()})`);

  // 52. Refresh while logged in
  await page.goto(BASE_URL + '/teacher/dashboard');
  await page.reload();
  await page.waitForTimeout(2000);
  console.log(`52. Refresh persistent login: ${page.url().includes('/teacher/dashboard') ? 'WORKS' : 'BROKEN'}`);

  await browser.close();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
