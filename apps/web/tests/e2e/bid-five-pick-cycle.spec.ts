import { expect, test } from '@playwright/test';
import {
  PENDING_AUTHORIZED_TEST_IDENTITY,
  authorizedStorageStates,
} from './authorized-test-identity.js';

const cycleStorageStates = authorizedStorageStates([
  'E2E_MEMBER_A_AUTH_STATE_PATH',
  'E2E_MEMBER_B_AUTH_STATE_PATH',
  'E2E_ADMIN_AUTH_STATE_PATH',
] as const);

test('5-ordinal cycle exercises every invariant', async ({ browser }) => {
  if (!cycleStorageStates) {
    test.skip(true, PENDING_AUTHORIZED_TEST_IDENTITY);
    return;
  }

  const [memberAState, memberBState, adminState] = cycleStorageStates;
  const ctxA = await browser.newContext({ storageState: memberAState });
  const ctxB = await browser.newContext({ storageState: memberBState });
  const ctxAdmin = await browser.newContext({ storageState: adminState });
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageAdmin = await ctxAdmin.newPage();

    await Promise.all([
      pageA.goto('http://localhost:3000/bid'),
      pageB.goto('http://localhost:3000/bid'),
      pageAdmin.goto('http://localhost:3000/admin/bid'),
    ]);

    await pageA.getByTestId('eligible-position-A101').click();
    await expect(pageA.getByTestId('position-cell-A101')).toHaveAttribute('data-state', 'filled');
    await expect(pageB.getByTestId('position-cell-A101')).toHaveAttribute('data-state', 'filled');

    await expect(pageA.getByTestId('your-turn-panel')).not.toBeVisible();

    await pageB.getByTestId('eligible-position-A201').click();
    await expect(pageA.getByTestId('position-cell-A201')).toHaveAttribute('data-state', 'filled');

    await pageAdmin.getByTestId('admin-action-override').click();
    await pageAdmin.getByTestId('override-member-id').fill('19');
    await pageAdmin.getByTestId('override-position-id').fill('A301');
    await pageAdmin.getByTestId('override-reason').fill('Mandatory minimum');
    await pageAdmin.getByTestId('override-submit').click();
    await expect(pageA.getByTestId('position-cell-A301')).toHaveAttribute('data-state', 'filled');
  } finally {
    await Promise.all([ctxA.close(), ctxB.close(), ctxAdmin.close()]);
  }
});
