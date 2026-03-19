import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const STUDENT_EMAIL = 'maya.sharma@university.edu';
const PASS = 'password123';

async function runModule12() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- MODULE 12: STUDENT CONTENT VIEWER (CRITICAL) ---');

  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[data-testid="input-email"]', STUDENT_EMAIL);
  await page.fill('[data-testid="input-password"]', PASS);
  await page.click('[data-testid="button-sign-in"]');
  await page.waitForURL('**/student/dashboard');

  // Navigate to first content item
  await page.goto(`${BASE_URL}/student/content/ci1`); // ci1 is from seed
  try {
      await page.waitForLoadState('networkidle');
      console.log(`T12.1 ✅ PASS — Content viewer loaded at ${page.url()}`);
  } catch(e) {
      console.log('T12.1 ❌ FAIL — Content viewer did not load');
  }
  await page.screenshot({ path: 'T12_1_viewer_load.png' });

  // T12.3 — Audio Format Switching
  await page.click('[data-testid="select-format"]');
  await page.click('text="Audio"');
  const audioPlayer = page.locator('p:has-text("Audio Player")');
  console.log(`T12.3 ${await audioPlayer.isVisible() ? '✅ PASS' : '❌ FAIL'} — Audio player visible`);
  await page.screenshot({ path: 'T12_3_audio_player.png' });

  // T12.6 — Braille Format (CRITICAL BUG)
  await page.click('[data-testid="select-format"]');
  await page.click('text="Braille"');
  const brailleDiv = page.locator('[aria-live="polite"]');
  const brailleText = await brailleDiv.textContent();
  console.log(`T12.6 — Braille content text: "${brailleText}"`);
  if (brailleText && brailleText.includes('⠠')) {
      console.log('T12.6 ✅ PASS — Braille Unicode detected');
  } else {
      console.log('T12.6 ❌ FAIL — No Braille Unicode found or dummy text');
  }
  await page.screenshot({ path: 'T12_6_braille_view.png' });

  // T12.7 — Simplified Format (CRITICAL BUG)
  await page.click('[data-testid="select-format"]');
  await page.click('text="Simplified"');
  const simplifiedHeader = page.locator('h2:has-text("Section 1")');
  console.log(`T12.7 ${await simplifiedHeader.isVisible() ? '✅ PASS' : '❌ FAIL'} — Simplified sections visible`);
  await page.screenshot({ path: 'T12_12_simplified_view.png' });

  // T12.11 — Focus Mode
  await page.click('[data-testid="button-focus-mode"]');
  const sidebar = page.locator('aside'); // AppSidebar uses <Sidebar> which is <aside>
  // In Focus mode it should be hidden
  const isHidden = await sidebar.evaluate(el => window.getComputedStyle(el).display === 'none' || el.getAttribute('aria-hidden') === 'true');
  console.log(`T12.11 — Sidebar is hidden: ${isHidden}`);

  await browser.close();
}

runModule12();
