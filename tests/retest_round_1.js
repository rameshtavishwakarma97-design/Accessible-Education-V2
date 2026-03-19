import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:54321';
const PASS = 'password123';
const ADMIN = 'priya.patel@university.edu';
const TEACHER = 'anand.rao@university.edu';
const STUDENT = 'maya.sharma@university.edu';

async function runRound1() {
  const browser = await chromium.launch();
  
  const roles = [
    { name: 'Admin', email: ADMIN, target: '/admin/dashboard' },
    { name: 'Teacher', email: TEACHER, target: '/teacher/dashboard' },
    { name: 'Student', email: STUDENT, target: '/student/dashboard' }
  ];

  console.log('--- ROUND 1: DASHBOARD ACCESS ---');

  for (const role of roles) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    try {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="input-email"]', role.email);
      await page.fill('[data-testid="input-password"]', PASS);
      await page.click('[data-testid="button-sign-in"]');
      await page.waitForURL(`**${role.target}`);
      console.log(`✅ PASS — ${role.name} reached dashboard. Errors: ${errors.length}`);
      if (errors.length > 0) console.log(`   - Errors: ${errors.slice(0, 2).join(' | ')}`);
    } catch (e) {
      console.log(`❌ FAIL — ${role.name} failed to reach dashboard: ${e.message}`);
    }
    await context.close();
  }

  await browser.close();
}

runRound1();
