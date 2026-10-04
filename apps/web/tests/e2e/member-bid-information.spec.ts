import { expect, test } from '@playwright/test';
import type { MemberBidFormResponse } from '../../../worker/src/lib/bid-form-source';
import { signJwt } from '../../lib/jwt';

for (const mode of ['mock', 'real'] as const) {
  test(`${mode} member information stays readable, read-only and keyboard accessible on desktop and phone`, async ({
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
        emp: 'synthetic-member-info',
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
          asOf: '2026-10-04',
          updatedAt: null,
          updatedAtScope: 'department_roster_sources',
          person: {
            id: 1,
            assignments: [
              {
                id: 'current-assignment',
                positionName: 'Current Captain',
                shift: 'B',
                station: 'Station 2',
                unit: 'Engine 2',
              },
            ],
            serviceRecord: { hiredAt: '2020-01-01', rankSeniority: 1 },
          },
          qualifications: {
            certifications: Array.from({ length: 40 }, (_, index) => ({
              credentialId: index + 1,
              credentialName:
                index === 0 ? 'Driver Engineer' : `Synthetic certification ${index + 1}`,
              status: index === 39 ? 'expired' : 'active',
              effectiveOn: '2020-01-01',
              expiresOn: index === 39 ? '2026-09-01' : null,
              evidenceSource: 'Synthetic personnel evidence',
              evidenceReference: null,
              eventId: null,
              origin: 'legacy_projection',
            })),
            specialties: [],
          },
        },
      }),
    );
    const id = `operator-workspace-e2e-systemic-${mode}-member-information-${testInfo.project.name}`;
    const formReads: string[] = [];
    await page.route('**/api/admin/bid-forms/*/members/*?*', async (route) => {
      formReads.push(route.request().url());
      const body: MemberBidFormResponse = {
        year: 2026,
        memberId: 1,
        sessionId: id,
        status: 'SUBMITTED',
        source: { name: 'Synthetic 2026BidForms.xlsx', sha256: 'a'.repeat(64) },
        sourceLocation: { sheet: 'Forms', row: 2 },
        archiveSha256: 'b'.repeat(64),
        publishedAt: '2026-10-04T14:00:00Z',
        airTechReference: null,
        form: {
          employeeId: 'synthetic-1',
          sourceName: 'Fixture, Current',
          sourceRank: 'Captain',
          attendingTeams: 'Yes',
          phone1: '555-0101',
          phone2: null,
          positionPreferences: [
            { order: 1, shift: 'C Shift', unit: 'Rescue 3' },
            { order: 2, shift: 'A Shift', unit: 'Combat Float' },
          ],
          aDayPreferences: [{ order: 1, sourceLabel: 'C3', shift: 'C', group: 'G3' }],
          sourceLocation: { sheet: 'Forms', row: 2 },
        },
      };
      await route.fulfill({ json: body });
    });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      const requestProtection =
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/csrf';
      if (!['GET', 'HEAD'].includes(request.method()) && !requestProtection)
        writes.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    for (const [width, height] of [
      [1280, 720],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/admin/bid?session_id=${id}`);
      const memberContext = page.getByRole('region', {
        name: 'Selected member details',
        exact: true,
      });
      const trigger = memberContext.getByRole('button', {
        name: 'View Capt Current Fixture details',
        exact: true,
      });
      await expect(trigger).toBeVisible();
      await expect(memberContext.getByText(/A-Day Group 4/)).toBeVisible();
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Capt Current Fixture', exact: true });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: 'Current staffing assignment', exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText('Current Captain · B · Station 2 · Engine 2', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByText('Historical Rescue Lieutenant', { exact: true })).toBeVisible();
      const overview = dialog.getByRole('tab', { name: 'Overview', exact: true });
      const credentials = dialog.getByRole('tab', { name: 'Credentials', exact: true });
      await overview.focus();
      await overview.press('ArrowRight');
      await expect(credentials).toBeFocused();
      await expect(overview).toHaveAttribute('aria-selected', 'true');
      await credentials.press('Enter');
      await expect(credentials).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.getByText('Driver Engineer', { exact: true })).toBeVisible();
      await expect(
        dialog.getByText(/Bid eligibility uses this session’s saved evidence/),
      ).toBeVisible();
      const scrollingBody = dialog.locator('.overscroll-contain');
      expect(
        await scrollingBody.evaluate((element) => element.scrollHeight > element.clientHeight),
      ).toBe(true);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(bounds?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(height + 1);
      const bidForm = dialog.getByRole('tab', { name: 'Bid form', exact: true });
      await bidForm.click();
      await expect(dialog.getByText('C Shift · Rescue 3', { exact: true })).toBeVisible();
      await expect(dialog.getByText('C shift · Group 3', { exact: true })).toBeVisible();
      await expect(
        dialog
          .locator('details')
          .filter({ has: page.locator('summary', { hasText: 'Contact information' }) }),
      ).not.toHaveAttribute('open');
      await expect(dialog.getByText('555-0101', { exact: true })).toBeHidden();
      expect(
        formReads.some((url) => {
          const parsed = new URL(url);
          return (
            parsed.pathname === '/api/admin/bid-forms/2026/members/1' &&
            parsed.searchParams.get('session_id') === id
          );
        }),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`member-info-${mode}-${width}.png`),
        fullPage: false,
      });
      await bidForm.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page.getByRole('region', { name: 'Bid positions', exact: true })).toBeVisible();
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
