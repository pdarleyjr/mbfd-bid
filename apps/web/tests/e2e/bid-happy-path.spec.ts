import { expect, test } from '@playwright/test';
import {
  PENDING_AUTHORIZED_TEST_IDENTITY,
  authorizedStorageState,
} from './authorized-test-identity.js';

const memberStorageState = authorizedStorageState('E2E_MEMBER_AUTH_STATE_PATH');

test('member 17 picks A101 — optimistic update then canonical fill', async ({ browser }) => {
  if (!memberStorageState) {
    test.skip(true, PENDING_AUTHORIZED_TEST_IDENTITY);
    return;
  }

  const context = await browser.newContext({ storageState: memberStorageState });
  const page = await context.newPage();
  try {
    await page.goto('http://localhost:3000/bid');
    await page.waitForLoadState('networkidle');
    const cell = page.getByTestId('position-cell-A101');
    await expect(cell).toHaveAttribute('data-state', 'eligible-open');
    await page.getByTestId('eligible-position-A101').click();
    await expect(cell).toHaveAttribute('data-state', 'pending-mine', { timeout: 500 });
    await expect(cell).toHaveAttribute('data-state', 'filled', { timeout: 2000 });
    await expect(cell).toContainText('Filled by member 17');
  } finally {
    await context.close();
  }
});
