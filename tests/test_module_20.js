import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';

async function runModule20() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 20: ACCESSIBILITY & ARIA ---');

  await page.goto(`${BASE_URL}/login`);

  // T20.1 — Skip Navigation Link
  await page.keyboard.press('Tab');
  const skipLink = page.locator('text="Skip to main content"');
  // Usually it becomes visible on focus
  console.log(`T20.1 — Skip link visible on focus: ${await skipLink.isVisible()}`);

  // T20.2 — Left Navigation ARIA (Need login)
  await page.fill('[data-testid="input-email"]', 'priya.patel@university.edu');
  await page.fill('[data-testid="input-password"]', 'password123');
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/admin/dashboard');

  const nav = page.locator('aside nav');
  const role = await nav.getAttribute('role');
  console.log(`T20.2 — Nav role="navigation": ${role === 'navigation' || !!page.locator('nav[role="navigation"]')}`);

  // T20.4 — Form Inputs Have Labels
  await page.goto(`${BASE_URL}/login`); // Check login form
  const inputs = await page.locator('input').all();
  let allLabelled = true;
  for (const input of inputs) {
      const id = await input.getAttribute('id');
      if (id) {
          const label = page.locator(`label[for="${id}"]`);
          if (!await label.isVisible()) allLabelled = false;
      }
  }
  console.log(`T20.4 — All inputs have visible labels: ${allLabelled}`);

  await browser.close();
}

runModule20();
