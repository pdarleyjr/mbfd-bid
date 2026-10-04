import { expect, test } from '@playwright/test';
import { signJwt } from '../../lib/jwt';

for (const mode of ['mock', 'real'] as const) {
  test(`${mode} has the same concise adjustments and session-bound presentation`, async ({
    page,
  }, testInfo) => {
    const key = process.env.JWT_SIGNING_KEY;
    if (!key) throw new Error('Isolated test signing key is required');
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
          asOf: '2026-10-03',
          person: { assignments: [], serviceRecord: { hiredAt: '2020-01-01', rankSeniority: 1 } },
          qualifications: { certifications: [] },
        },
      }),
    );
    await page.route('**/api/auth/csrf', (route) =>
      route.fulfill({ json: { token: 'csrf_00000000-0000-0000-0000-000000000001' } }),
    );
    const previews: Record<string, unknown>[] = [];
    const commands: Record<string, unknown>[] = [];
    await page.route('**/commands/live/preview', async (route) => {
      const body = route.request().postDataJSON();
      previews.push(body);
      await route.fulfill({
        json: {
          valid: true,
          expectedSeq: body.expectedSeq,
          memberId: body.memberId,
          positionId: body.positionId,
          nextMemberId: 1,
          warnings: [
            { code: 'OUT_OF_ORDER', message: 'This member selects before their ordinary turn.' },
            { code: 'A_DAY_DEFERRED', message: 'A-Day remains due.' },
          ],
        },
      });
    });
    await page.route('**/commands/live', async (route) => {
      commands.push(route.request().postDataJSON());
      await route.fulfill({ json: { kind: 'accepted' } });
    });
    const id = `operator-workspace-e2e-systemic-${mode}-${testInfo.project.name}`;
    await page.goto(`/admin/bid?session_id=${id}`);
    await expect(
      page.getByRole('link', { name: 'Open presentation', exact: true }),
    ).toHaveAttribute('href', `/live?bidSessionId=${id}`);
    await expect(
      page.getByRole('link', { name: 'Open presentation', exact: true }),
    ).toHaveAttribute('target', '_blank');
    await page.getByRole('button', { name: 'Adjust bid', exact: true }).click();
    const adjustment = page.getByRole('dialog', { name: 'Adjust bid' });
    await expect(adjustment).toBeVisible();
    await expect(
      adjustment.getByRole('combobox', { name: 'Administrator override action' }).locator('option'),
    ).toHaveText([
      'Assign an open seat',
      'Set or change A-Day',
      'Assign temporary duty',
      'Skip member for now',
      'Defer member for later',
      'Bypass current step · keep its picks pending',
    ]);
    await adjustment
      .getByRole('combobox', { name: 'Administrator override member' })
      .selectOption('2');
    await adjustment
      .getByRole('combobox', { name: 'Administrator override open position' })
      .selectOption('B-fixture');
    await adjustment.getByRole('checkbox', { name: 'Pick A-Day later' }).check();
    await expect(adjustment.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('');
    await adjustment.getByRole('button', { name: 'Review adjustment', exact: true }).click();
    await expect(adjustment.getByText('A-Day remains due.', { exact: true })).toBeVisible();
    expect(previews).toHaveLength(1);
    expect(commands).toHaveLength(0);
    expect(previews[0]).not.toHaveProperty('aDay');
    expect(previews[0]?.reason).toBe('');
    await expect(
      adjustment.getByRole('button', { name: 'Confirm administrator selection', exact: true }),
    ).toBeDisabled();
    await adjustment
      .getByRole('checkbox', { name: 'I acknowledge the override advisories' })
      .check();
    await adjustment
      .getByRole('button', { name: 'Confirm administrator selection', exact: true })
      .click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      expectedSeq: 4,
      memberId: 2,
      positionId: 'B-fixture',
      reason: '',
      adminOverride: { acknowledged: true, warningCodes: ['OUT_OF_ORDER', 'A_DAY_DEFERRED'] },
    });
    expect(commands[0]).not.toHaveProperty('aDay');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`systemic-${mode}.png`), fullPage: false });
  });
}
