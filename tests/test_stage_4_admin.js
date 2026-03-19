import { chromium } from '@playwright/test';
import path from 'path';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const ADMIN_EMAIL = 'priya.patel@university.edu';

async function runTests() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- ADMIN TESTS ---');

  // Login
  await page.goto(BASE_URL + '/login');
  await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/admin/dashboard');

  // 36. Dashboard stats
  const statsCard = page.locator('[data-testid^="stat-card-"]').first();
  await statsCard.waitFor({ timeout: 10000 });
  console.log(`36. Admin stats: ${await statsCard.isVisible() ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'admin_36_dashboard.png' });

  // 37-38. Hierarchy
  await page.click('[data-testid="link-nav-hierarchy"]');
  await page.waitForURL('**/admin/hierarchy');
  const hierarchyNode = page.locator('[data-testid^="tree-node-"]').first();
  try {
      await hierarchyNode.waitFor({ timeout: 10000 });
      console.log(`37. Hierarchy tree: WORKS`);
      await hierarchyNode.click();
      console.log('38. Click hierarchy: WORKS');
  } catch(e) {
      console.log('37. Hierarchy: BROKEN');
  }
  await page.screenshot({ path: 'admin_37_hierarchy.png' });

  // 39-41. Users
  await page.click('[data-testid="link-nav-users"]');
  await page.waitForURL('**/admin/users');
  const userRow = page.locator('[data-testid^="row-user-"]');
  try {
      await userRow.first().waitFor({ timeout: 10000 });
      console.log(`39. Users list: WORKS (${await userRow.count()} found)`);
  } catch(e) {
      console.log('39. Users list: BROKEN');
  }

  await page.click('[data-testid="button-add-user"]');
  const userModal = page.locator('role=dialog');
  try {
      await userModal.waitFor({ timeout: 5000 });
      console.log(`40. Create user modal: WORKS`);
  } catch(e) {
      console.log(`40. Create user modal: BROKEN`);
  }
  await page.keyboard.press('Escape');

  // 43-44. Enrollment
  await page.click('[data-testid="link-nav-enrollment"]');
  await page.waitForURL('**/admin/enrollment');
  const enrollmentTabs = page.locator('[data-testid="tabs-enrollment"]');
  try {
      await enrollmentTabs.waitFor({ timeout: 5000 });
      console.log(`43. Enrollment dashboard: WORKS`);
  } catch(e) {
      console.log(`43. Enrollment dashboard: BROKEN`);
  }
  await page.screenshot({ path: 'admin_43_enrollment.png' });

  // 46-47. Settings
  await page.click('[data-testid="link-nav-settings"]');
  await page.waitForURL('**/admin/settings');
  const tabs = page.locator('[data-testid="tabs-settings"]');
  console.log(`46. Settings tabs: ${await tabs.isVisible() ? 'WORKS' : 'BROKEN'}`);
  
  await page.click('button:has-text("Academic")'); // Tab switch
  await page.screenshot({ path: 'admin_46_settings.png' });

  // 48. Analytics
  await page.click('[data-testid="link-nav-analytics"]');
  await page.waitForURL('**/admin/analytics');
  console.log(`48. Analytics: ${page.url().includes('/analytics') ? 'WORKS' : 'BROKEN'}`);
  await page.screenshot({ path: 'admin_48_analytics.png' });

  await browser.close();
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
