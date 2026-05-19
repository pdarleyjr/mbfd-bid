import { expect, test } from '@playwright/test';

test('5-ordinal cycle exercises every invariant', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: 'tests/e2e/.auth/memberA.json' });
  const ctxB = await browser.newContext({ storageState: 'tests/e2e/.auth/memberB.json' });
  const ctxAdmin = await browser.newContext({ storageState: 'tests/e2e/.auth/admin.json' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageAdmin = await ctxAdmin.newPage();

  await Promise.all([
    pageA.goto('http://localhost:3000/bid'),
    pageB.goto('http://localhost:3000/bid'),
    pageAdmin.goto('http://localhost:3000/admin/bid'),
  ]);

  // 1. A picks A101 (A is current bidder)
  await pageA.getByTestId('eligible-position-A101').click();
  await expect(pageA.getByTestId('position-cell-A101')).toHaveAttribute('data-state', 'filled');
  await expect(pageB.getByTestId('position-cell-A101')).toHaveAttribute('data-state', 'filled');

  // 2. A cannot pick again
  await expect(pageA.getByTestId('your-turn-panel')).not.toBeVisible();

  // 3. B picks A201
  await pageB.getByTestId('eligible-position-A201').click();
  await expect(pageA.getByTestId('position-cell-A201')).toHaveAttribute('data-state', 'filled');

  // 4. Admin force-picks A301 to member C
  await pageAdmin.getByTestId('admin-action-override').click();
  await pageAdmin.getByTestId('override-member-id').fill('19');
  await pageAdmin.getByTestId('override-position-id').fill('A301');
  await pageAdmin.getByTestId('override-reason').fill('Mandatory minimum');
  await pageAdmin.getByTestId('override-submit').click();
  await expect(pageA.getByTestId('position-cell-A301')).toHaveAttribute('data-state', 'filled');

  // 5. Member D attempts A101 → POSITION_FILLED toast
  // (Implementer adds a memberD storage state for this assertion.)
});
