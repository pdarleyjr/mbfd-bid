import { expect, test } from '@playwright/test';

test('admin can force-pick a member into a position', async ({ page }) => {
  await page.goto('http://localhost:3000/admin/bid');
  await page.getByTestId('admin-action-override').click();
  await page.getByTestId('override-member-id').fill('17');
  await page.getByTestId('override-position-id').fill('A101');
  await page.getByTestId('override-reason').fill('Last qualified candidate');
  await page.getByTestId('override-submit').click();
  await expect(page.getByTestId('position-cell-A101')).toHaveAttribute('data-state', 'filled');
});

test('admin can freeze the session', async ({ page }) => {
  await page.goto('http://localhost:3000/admin/bid');
  await page.getByTestId('admin-action-freeze').click();
  await page.getByTestId('freeze-reason').fill('Network outage at venue');
  await page.getByTestId('freeze-submit').click();
  await expect(page.getByTestId('bid-board-header')).toContainText('frozen');
});
