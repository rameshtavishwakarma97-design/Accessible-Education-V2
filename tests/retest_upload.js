import { chromium } from '@playwright/test';
import path from 'path';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const TEACHER = 'anand.rao@university.edu';

async function runUploadTest() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('--- UPLOADING PDF AS TEACHER ---');

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[data-testid="input-email"]', TEACHER);
    await page.fill('[data-testid="input-password"]', PASS);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/teacher/dashboard');

    const courseCard = page.locator('[data-testid^="card-course-"]').first();
    await courseCard.click();
    await page.waitForURL('**/teacher/courses/**');

    await page.click('[data-testid="button-upload-content"]');
    await page.fill('[data-testid="input-content-title"]', 'Conversion Test PDF ' + Date.now());
    
    // Select PDF Document
    await page.click('[data-testid="select-content-type"]');
    await page.click('role=option[name="PDF Document"]');
    await page.click('[data-testid="button-upload-next"]');
    
    // Step 2: Course/Sections
    await page.click('[data-testid="button-upload-next"]');

    // Step 3: File Upload
    const filePath = path.resolve('uploads', '1771913976375-Rules.pdf');
    await page.setInputFiles('input[type="file"]', filePath);
    
    await page.click('[data-testid="button-upload-convert"]');

    // Check toast
    const toast = page.locator('div:has-text("Upload started")').first();
    await toast.waitFor({ timeout: 10000 });
    console.log('✅ PASS — Success toast "Upload started" appeared');

    console.log('Waiting 30 seconds for conversion pipeline to run...');
    await page.waitForTimeout(30000);

  } catch (e) {
    console.log(`❌ FAIL — Upload Error: ${e.message}`);
  }

  await browser.close();
}

runUploadTest();
