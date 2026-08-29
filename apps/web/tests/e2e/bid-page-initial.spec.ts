import { expect, test } from '@playwright/test';
import { PENDING_AUTHORIZED_TEST_IDENTITY, authorizedJwt } from './authorized-test-identity.js';

const memberJwt = authorizedJwt('E2E_MEMBER_JWT');

test('GET /bid as authenticated member renders the board header + grid', async ({
  page,
  context,
}) => {
  if (!memberJwt) {
    test.skip(true, PENDING_AUTHORIZED_TEST_IDENTITY);
    return;
  }

  await context.addCookies([
    { name: 'mbfd_pin', value: '1', domain: 'localhost', path: '/' },
    { name: 'mbfd_jwt', value: memberJwt, domain: 'localhost', path: '/' },
  ]);
  await page.goto('http://localhost:3000/bid');
  await expect(page.getByTestId('bid-board-header')).toBeVisible();
  await expect(page.getByTestId('position-grid')).toBeVisible();
  // 230+ position cells should render (Plan 02 seed produces 232).
  const cells = page.getByTestId(/position-cell-/);
  await expect(cells).toHaveCount(232);
});
