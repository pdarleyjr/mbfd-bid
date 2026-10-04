import { expect, test } from '@playwright/test';
import { signJwt } from '../../lib/jwt';

for (const mode of ['mock', 'real'] as const) {
  test(`${mode} operator board keeps waiting, awarded and seat context usable at every width`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const key = process.env.JWT_SIGNING_KEY;
    if (!key) throw new Error('Isolated test signing key required');
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(
      {
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-layout',
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
        value: jwt,
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
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      // Request protection can be prepared while opening session tools;
      // navigating this workspace must never submit a bid operation.
      const requestProtection =
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/csrf';
      if (!['GET', 'HEAD'].includes(request.method()) && !requestProtection)
        writes.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const id = `operator-workspace-e2e-systemic-${mode}-board-layout-${testInfo.project.name}`;
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720],
      [1024, 768],
      [810, 668],
      [390, 844],
      [320, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/admin/bid?session_id=${id}`);
      // Address the accessible board, excluding Next's temporary hidden
      // streamed Suspense scaffold before hydration finishes.
      const board = page.getByRole('region', { name: 'Bid positions', exact: true });
      await expect(board.getByTestId('position-cell-A001')).toBeVisible();
      const memberPanel = page.getByRole('region', { name: 'Selected member details' });
      await expect(
        memberPanel.getByRole('heading', { name: 'Capt Current Fixture' }),
      ).toBeVisible();
      await expect(memberPanel.getByText(/old-A109 · Historical Rescue Lieutenant/)).toBeVisible();
      await expect(memberPanel.getByText(/A-Day Group 4/)).toBeVisible();
      if (width < 1024)
        await page.getByRole('button', { name: 'Remaining · 2', exact: true }).click();
      const remaining = page.getByRole('complementary', { name: 'Remaining members' });
      await expect(remaining.getByTestId('operator-member-remaining-1')).toHaveAttribute(
        'data-status',
        'current',
      );
      await expect(remaining.getByTestId('operator-member-remaining-2')).toHaveAttribute(
        'data-status',
        'on-deck',
      );
      await expect(remaining.getByTestId('operator-member-remaining-3')).toHaveCount(0);
      if (width < 1024)
        await page.getByRole('button', { name: 'Remaining · 2', exact: true }).click();
      if (width < 1024)
        await page.getByRole('button', { name: 'Already bid · 1', exact: true }).click();
      await page
        .getByRole('complementary', { name: 'Members who already bid', exact: true })
        .getByTestId('operator-member-picked-3')
        .click();
      await expect(memberPanel.getByRole('heading', { name: 'FF Awarded Fixture' })).toBeVisible();
      await expect(memberPanel).toContainText('A002');
      await page.getByRole('button', { name: 'Return to current bidder', exact: true }).click();
      for (const shift of ['B', 'C', 'D', 'A']) {
        await board.getByTestId(`shift-tab-${shift}`).click();
        await expect(board.getByTestId(`position-cell-${shift}001`)).toBeVisible();
      }
      await board.getByTestId('position-cell-A002').click();
      await expect(memberPanel.getByRole('heading', { name: 'FF Awarded Fixture' })).toBeVisible();
      await expect(
        page.getByRole('dialog', { name: 'Record selection', exact: true }),
      ).toBeHidden();
      await page.getByRole('button', { name: 'Return to current bidder', exact: true }).click();
      for (const [label, menuId] of [
        ['Session tools', 'bid-session-tools'],
        ['Board tools', 'operator-board-view'],
      ] as const) {
        const toggle = page.getByRole('button', { name: label, exact: true });
        if (!(await toggle.isVisible())) continue;
        await toggle.click();
        const menu = page.getByRole('main').locator(`#${menuId}`);
        await expect(menu).toBeVisible();
        const menuBounds = await menu.boundingBox();
        expect(menuBounds).not.toBeNull();
        expect(menuBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(width + 1);
        await toggle.press('Escape');
        await expect(toggle).toBeFocused();
        await expect(menu).toBeHidden();
      }
      for (const label of [/^Eligible choices ·/, /^Alerts ·/, /^More controls$/]) {
        const summary = page.getByRole('main').locator('summary').filter({ hasText: label });
        await summary.click();
        const menuBounds = await summary.locator('..').locator('div').first().boundingBox();
        expect(menuBounds).not.toBeNull();
        expect(menuBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(width + 1);
        await summary.click();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
      ).toBe(true);
      const bounds = await board.boundingBox();
      expect(bounds).not.toBeNull();
      if (width >= 810) {
        expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(200);
        const seatBounds = await board.getByTestId('position-cell-A001').boundingBox();
        expect(seatBounds).not.toBeNull();
        expect((seatBounds?.y ?? height) + (seatBounds?.height ?? 0)).toBeLessThanOrEqual(height);
      }
      await page.screenshot({
        path: testInfo.outputPath(`operator-board-${mode}-${width}.png`),
        fullPage: false,
      });
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
