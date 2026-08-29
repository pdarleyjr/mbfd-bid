import { expect, test } from '@playwright/test';
import {
  PENDING_AUTHORIZED_TEST_IDENTITY,
  authorizedStorageState,
} from './authorized-test-identity.js';

const adminStorageState = authorizedStorageState('E2E_ADMIN_AUTH_STATE_PATH');

test('admin can force-pick a member into a position', async ({ browser }) => {
  if (!adminStorageState) {
    test.skip(true, PENDING_AUTHORIZED_TEST_IDENTITY);
    return;
  }

  const context = await browser.newContext({ storageState: adminStorageState });
  const page = await context.newPage();
  try {
    await page.goto('http://localhost:3000/admin/bid');
    await page.getByTestId('admin-action-override').click();
    await page.getByTestId('override-member-id').fill('17');
    await page.getByTestId('override-position-id').fill('A101');
    await page.getByTestId('override-reason').fill('Last qualified candidate');
    await page.getByTestId('override-submit').click();
    await expect(page.getByTestId('position-cell-A101')).toHaveAttribute('data-state', 'filled');
  } finally {
    await context.close();
  }
});

test('admin can freeze the session', async ({ browser }) => {
  if (!adminStorageState) {
    test.skip(true, PENDING_AUTHORIZED_TEST_IDENTITY);
    return;
  }

  const context = await browser.newContext({ storageState: adminStorageState });
  const page = await context.newPage();
  try {
    await page.goto('http://localhost:3000/admin/bid');
    await page.getByTestId('admin-action-freeze').click();
    await page.getByTestId('freeze-reason').fill('Network outage at venue');
    await page.getByTestId('freeze-submit').click();
    await expect(page.getByTestId('bid-board-header')).toContainText('frozen');
  } finally {
    await context.close();
  }
});
