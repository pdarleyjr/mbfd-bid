import { expect, test } from '@playwright/test';

test('member 17 picks A101 — optimistic update then canonical fill', async ({ page }) => {
  await page.goto('http://localhost:3000/bid');
  // Wait for hydration
  await page.waitForLoadState('networkidle');
  // Assume test session has member 17 active and A101 open + eligible
  const cell = page.getByTestId('position-cell-A101');
  await expect(cell).toHaveAttribute('data-state', 'eligible-open');
  await page.getByTestId('eligible-position-A101').click();
  // Optimistic state
  await expect(cell).toHaveAttribute('data-state', 'pending-mine', { timeout: 500 });
  // Canonical fill from DO
  await expect(cell).toHaveAttribute('data-state', 'filled', { timeout: 2000 });
  await expect(cell).toContainText('Filled by member 17');
});
