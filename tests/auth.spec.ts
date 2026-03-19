import { test, expect } from '@playwright/test';

const USERS = {
  admin: { email: 'priya.patel@university.edu', password: 'password123', dashboard: '/admin/dashboard' },
  teacher: { email: 'anand.rao@university.edu', password: 'password123', dashboard: '/teacher/dashboard' },
  student: { email: 'maya.sharma@university.edu', password: 'password123', dashboard: '/student/dashboard' },
};

test.describe('Module 1: Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('Valid login for Admin', async ({ page }) => {
    await page.fill('[data-testid="input-email"]', USERS.admin.email);
    await page.fill('[data-testid="input-password"]', USERS.admin.password);
    await page.click('[data-testid="button-sign-in"]');
    // Ensure navigation finishes
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(USERS.admin.dashboard), { timeout: 15000 });
  });

  test('Valid login for Teacher', async ({ page }) => {
    await page.fill('[data-testid="input-email"]', USERS.teacher.email);
    await page.fill('[data-testid="input-password"]', USERS.teacher.password);
    await page.click('[data-testid="button-sign-in"]');
    await expect(page).toHaveURL(new RegExp(USERS.teacher.dashboard), { timeout: 10000 });
  });

  test('Valid login for Student', async ({ page }) => {
    await page.fill('[data-testid="input-email"]', USERS.student.email);
    await page.fill('[data-testid="input-password"]', USERS.student.password);
    await page.click('[data-testid="button-sign-in"]');
    await expect(page).toHaveURL(new RegExp(USERS.student.dashboard), { timeout: 10000 });
  });

  test('Invalid login shows error message', async ({ page }) => {
    await page.fill('[data-testid="input-email"]', 'wrong@university.edu');
    await page.fill('[data-testid="input-password"]', 'wrongpass');
    await page.click('[data-testid="button-sign-in"]');
    const errorMsg = page.locator('[data-testid="text-login-error"]');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText(/failed|check your credentials|invalid credentials/i);
  });

  test('Logout clears session and redirects to login', async ({ page }) => {
    // Login first
    await page.fill('[data-testid="input-email"]', USERS.student.email);
    await page.fill('[data-testid="input-password"]', USERS.student.password);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/student/dashboard');

    // Click logout
    const logoutBtn = page.locator('[data-testid="button-logout"]');
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/login/);

    // Try to go back to dashboard
    await page.goto('/student/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Protected routes redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/login/);
    
    await page.goto('/teacher/dashboard');
    await expect(page).toHaveURL(/\/login/);
    
    await page.goto('/student/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Token persists on page refresh', async ({ page }) => {
    await page.fill('[data-testid="input-email"]', USERS.student.email);
    await page.fill('[data-testid="input-password"]', USERS.student.password);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/student/dashboard');

    await page.reload();
    await expect(page).toHaveURL(new RegExp(USERS.student.dashboard));
  });
});
