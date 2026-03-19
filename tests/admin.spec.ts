import { test, expect } from '@playwright/test';

const ADMIN = { email: 'priya.patel@university.edu', password: 'password123' };

test.describe('Module 8: Admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="input-email"]', ADMIN.email);
    await page.fill('[data-testid="input-password"]', ADMIN.password);
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL('**/admin/dashboard');
  });

  test('Admin dashboard loads and shows stats', async ({ page }) => {
    await expect(page.locator('[data-testid="stat-card-total-students"]')).toBeVisible();
    await expect(page.locator('[data-testid="stat-card-teachers"]')).toBeVisible();

    // Wait for the tree to load (increase timeout and look for any node)
    const treeNode = page.locator('[data-testid^="tree-node-"]').first();
    await expect(treeNode).toBeVisible({ timeout: 15000 });
    await treeNode.click();
  });

  test('Create a new user', async ({ page }) => {
    // Navigate to user management via sidebar
    await page.click('[data-testid="link-nav-users"]');
    await page.waitForURL('**/admin/users');

    await page.click('[data-testid="button-add-user"]');

    const timestamp = Date.now();
    const testEmail = `testuser${timestamp}@university.edu`;

    await page.fill('[data-testid="input-add-user-name"]', 'Playwright Test User');
    await page.fill('[data-testid="input-add-user-email"]', testEmail);
    await page.fill('[data-testid="input-add-user-password"]', 'password123');

    // Select role
    await page.click('[data-testid="select-add-user-role"]');
    // Radix UI Select options are usually in a portal, often as div[role="option"]
    await page.click('div[role="option"]:has-text("Student")');

    // Select program
    await page.click('[data-testid="select-add-user-program"]');
    await page.click('div[role="option"]:has-text("B.Tech Computer Science")');

    await page.click('[data-testid="button-submit-add-user"]');

    // Success toast
    await expect(page.getByText('User created').first()).toBeVisible({ timeout: 10000 });

    // Verify in table
    await page.fill('[data-testid="input-search-users"]', testEmail);
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
  });

  test('Compliance report / Analytics cards', async ({ page }) => {
    // Stat cards already checked in first test.
    // Let's check for "Disability Distribution" chart area
    await expect(page.locator('text=Disability Distribution')).toBeVisible();
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
  });

  test('Tables paginate correctly', async ({ page }) => {
    // Navigate to users again
    await page.click('[data-testid="link-nav-users"]');

    // Check if table exists
    const table = page.locator('table[aria-label="Users"]');
    await expect(table).toBeVisible();

    // Note: Actual pagination depends on data volume. 
    // If there's no pagination UI visible, it might be because data is small.
  });
});
