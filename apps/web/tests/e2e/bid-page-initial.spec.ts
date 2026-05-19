import { expect, test } from '@playwright/test';

test('GET /bid as authenticated member renders the board header + grid', async ({
  page,
  context,
}) => {
  // Helper: prime PIN + member JWT cookies. Implementer lifts the helper used
  // by existing Plan 01/02 E2E tests (apps/web/tests/e2e/_helpers/auth.ts).
  await context.addCookies([
    { name: 'mbfd_pin', value: '1', domain: 'localhost', path: '/' },
    { name: 'mbfd_jwt', value: process.env.E2E_MEMBER_JWT ?? '', domain: 'localhost', path: '/' },
  ]);
  await page.goto('http://localhost:3000/bid');
  await expect(page.getByTestId('bid-board-header')).toBeVisible();
  await expect(page.getByTestId('position-grid')).toBeVisible();
  // 230+ position cells should render (Plan 02 seed produces 232).
  const cells = page.getByTestId(/position-cell-/);
  await expect(cells).toHaveCount(232);
});
