import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';

const pages = [
  { url: '/login', role: 'guest' },
  { url: '/student/dashboard', role: 'student', email: 'maya.sharma@university.edu' },
  { url: '/teacher/dashboard', role: 'teacher', email: 'anand.rao@university.edu' },
  { url: '/admin/dashboard', role: 'admin', email: 'priya.patel@university.edu' },
];

async function runModule22() {
  const browser = await chromium.launch();
  
  console.log('--- MODULE 22: CONSOLE ERROR SWEEP ---');

  for (const p of pages) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    const warnings = [];

    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    if (p.role !== 'guest') {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="input-email"]', p.email);
      await page.fill('[data-testid="input-password"]', PASS);
      await page.click('[data-testid="button-sign-in"]');
      await page.waitForURL(`**${p.url}`);
    } else {
      await page.goto(`${BASE_URL}${p.url}`);
    }

    await page.waitForTimeout(2000);
    console.log(`Page: ${p.url} | Errors: ${errors.length} | Warnings: ${warnings.length}`);
    if (errors.length > 0) console.log(`  - ERRORS: ${errors.slice(0, 3).join(' | ')}`);
    
    await context.close();
  }

  await browser.close();
}

runModule22();
