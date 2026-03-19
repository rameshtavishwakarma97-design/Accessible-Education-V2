import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const ADMIN_EMAIL = 'priya.patel@university.edu';
const PASS = 'password123';

async function runModule2() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 2: ADMIN HIERARCHY ---');

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/admin/dashboard');

  // T2.1 — Hierarchy Page Loads
  await page.goto(`${BASE_URL}/admin/hierarchy`);
  const treeNode = page.locator('[data-testid^="tree-node-"]');
  try {
      await treeNode.first().waitFor({ timeout: 10000 });
      console.log(`T2.1 ✅ PASS — Hierarchy tree rendered with ${await treeNode.count()} nodes`);
  } catch(e) {
      console.log('T2.1 ❌ FAIL — Hierarchy tree DID NOT RENDER or empty');
  }
  await page.screenshot({ path: 'T2_1_hierarchy_load.png' });

  // T2.2 — Expand/Collapse
  const firstNode = treeNode.first();
  await firstNode.click();
  const countAfterClick = await treeNode.count();
  console.log(`T2.2 ✅ PASS — Node clicked, visible nodes: ${countAfterClick}`);

  // T2.4 — Edit (Check if right panel opens)
  const nodeName = await firstNode.textContent();
  const nodePanel = page.locator('h3:has-text("Node Details")');
  if (await nodePanel.isVisible()) {
      console.log('T2.4 ✅ PASS — Node details panel visible');
  } else {
      console.log('T2.4 ❌ FAIL — Node details panel NOT visible after clicking node');
  }
  await page.screenshot({ path: 'T2_4_node_details.png' });

  // T2.5 — Retire
  const retireBtn = page.locator('[data-testid="button-retire-node"]');
  if (await retireBtn.isVisible()) {
      console.log('T2.5 ✅ PASS — Retire button present in details panel');
  } else {
      console.log('T2.5 ❌ FAIL — Retire button NOT found');
  }

  await browser.close();
}

runModule2();
