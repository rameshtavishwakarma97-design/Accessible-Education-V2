import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';

async function runModule0() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('--- MODULE 0 ---');

  // T0.1 — Application Loads
  try {
    const response = await page.goto(BASE_URL);
    const title = await page.title();
    console.log(`T0.1 ✅ PASS — Title: "${title}", URL: ${page.url()}`);
    await page.screenshot({ path: 'T0_1_load.png' });
  } catch (e) {
    console.log(`T0.1 ❌ FAIL — Page did not load: ${e.message}`);
  }

  // T0.2 — Backend Health
  try {
    const response = await page.goto(`${BASE_URL}/api/health`);
    const body = await page.textContent('body');
    console.log(`T0.2 ⚠️ PARTIAL — Health Body: ${body}`);
    // Note: Spec expected redis, but we have db and storage.
  } catch (e) {
    console.log(`T0.2 ❌ FAIL — Health endpoint failed: ${e.message}`);
  }

  // T0.3 — Swagger API Docs
  try {
    const response = await page.goto(`${BASE_URL}/api/docs`);
    if (response.status() === 404) {
        console.log('T0.3 🔲 NOT FOUND — Swagger UI not found at /api/docs');
    } else {
        console.log(`T0.3 — Status: ${response.status()}`);
    }
  } catch (e) {
    console.log(`T0.3 🔲 NOT FOUND — Swagger endpoint failed`);
  }

  await browser.close();
}

runModule0();
