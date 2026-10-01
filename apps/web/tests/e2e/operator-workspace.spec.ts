import { expect, test } from '@playwright/test';
import { signJwt } from '../../lib/jwt';

test('member details, historical assignment and explicit bid confirmation work in the isolated console', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('An explicit isolated test signing key is required');
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: 901,
      hub_user_id: 901,
      member_id: 901,
      emp: 'synthetic-operator',
      role: 'admin',
      security_version: 1,
      rank: 'CPT',
      first_name: 'Synthetic',
      last_name: 'Operator',
      fresh_auth_at: now,
      authz_checked_at: now,
    },
    key,
    '1h',
  );
  await page.context().addCookies([
    {
      name: 'mbfd_pin',
      value: 'ok',
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
    {
      name: 'mbfd_bid_jwt',
      value: token,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.route('**/api/admin/department/people/*', (route) =>
    route.fulfill({
      json: {
        asOf: '2026-10-01',
        person: { assignments: [], serviceRecord: { hiredAt: '2020-01-01', rankSeniority: 1 } },
        qualifications: { certifications: [] },
      },
    }),
  );
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({
      json: {
        token: 'csrf_00000000-0000-0000-0000-000000000001',
      },
    }),
  );
  const commands: Record<string, unknown>[] = [];
  await page.route('**/commands/live', async (route) => {
    commands.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { kind: 'rejected', code: 'LIVE_STALE_SEQUENCE' } });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [width, height] of [
    [810, 668],
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/admin/bid?session_id=operator-workspace-e2e-${testInfo.project.name}`);
    const panel = page.getByRole('region', { name: 'Selected member details' });
    await expect(panel.getByRole('heading', { name: 'Capt Current Fixture' })).toBeVisible();
    await expect(panel.getByText('Historical Rescue Lieutenant', { exact: true })).toBeVisible();
    await expect(panel.getByText(/old-A109.*Group 4/)).toBeVisible();
    const available = page.getByRole('region', { name: 'Available positions' });
    await available.getByRole('button', { name: /Engine 2/ }).click();
    expect(commands).toHaveLength(0);
    const group = page.getByRole('combobox', { name: 'Selection A-Day' });
    await expect(group.locator('option')).toHaveText([
      'Select A-Day',
      'Group 1',
      'Group 2',
      'Group 3',
      'Group 4',
    ]);
    await group.selectOption('G3');
    await page.getByText('Choose member · 2', { exact: true }).click();
    await page.getByRole('button', { name: /Capt Waiting Fixture/ }).click();
    await expect(panel.getByRole('heading', { name: 'Capt Waiting Fixture' })).toBeVisible();
    await expect(
      panel.getByText('Previous bid history has not been linked to this member.'),
    ).toBeVisible();
    await expect(available.getByRole('button', { name: /Engine 2/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Confirm bid', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Return to current bidder' }).click();
    await available.getByRole('button', { name: 'B shift', exact: true }).click();
    await expect(available.getByRole('button', { name: /Engine 4/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`operator-${width}.png`), fullPage: true });
    if (width === 810) {
      await expect(page.getByTestId('admin-sidebar')).toHaveAttribute('data-collapsed', 'true');
    }
  }
  await page.getByRole('button', { name: 'Confirm bid', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'live.record_selection',
    memberId: 1,
    positionId: 'A-fixture',
    aDay: 'G3',
    expectedSeq: 4,
  });
  await expect(page.getByRole('combobox', { name: 'Selection A-Day' })).toHaveValue('G3');
  expect(errors).toEqual([]);
});
