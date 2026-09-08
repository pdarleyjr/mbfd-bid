import { type Page, expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

async function localOperator(page: Page) {
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Explicit isolated test key required');
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const now = Math.floor(Date.now() / 1000);
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-ui-operator',
        role: 'admin',
        security_version: 1,
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: now,
        authz_checked_at: now,
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
    .setProtectedHeader({ alg: 'HS256' })
    .sign(/^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, 'hex') : new TextEncoder().encode(key));
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
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('dense dynamic Board preserves all assignments, search, disclosure and responsive geometry', async ({
  page,
}, info) => {
  await localOperator(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/admin/annual-plan', (route) => route.fulfill({ json: { plans: [] } }));
  await page.route('**/api/admin/bid-board?**', (route) =>
    route.fulfill({
      json: {
        view: 'current',
        lifecycle: 'CURRENT',
        generatedAt: '2026-09-07T12:00:00Z',
        source: {
          label: 'Synthetic UI geometry fixture',
          year: null,
          asOf: '2026-09-07',
          sessionId: null,
          templateVersion: null,
          ruleBookVersion: null,
          configurationRevision: null,
          ruleBookRevision: null,
          completionRevision: null,
        },
        notice: null,
        seats: Array.from({ length: 46 }, (_, i) => ({
          id: `synthetic-seat-${i}`,
          shift: 'A',
          station:
            i < 2
              ? 'Division Chief'
              : i < 4
                ? 'Fire Union'
                : i < 10
                  ? 'Rescue Float Pool'
                  : String(7 + Math.floor((i - 10) / 12)),
          unit: i < 10 ? 'Configured group' : i % 3 === 0 ? 'Engine' : 'Rescue',
          position: i % 3 === 0 ? 'Lieutenant' : 'Firefighter',
          rank: i % 3 === 0 ? 'LT' : 'FF',
          occupancy: i === 45 ? 'vacant' : 'occupied',
          occupant:
            i === 45
              ? null
              : { memberId: 1000 + i, name: `Synthetic Member ${i}`, nameSource: 'current' },
          assignmentOrigin: 'ADMIN_TRANSFER',
          temporaryContext:
            i === 44
              ? [
                  {
                    id: 'overlay-fixture',
                    kind: 'LIGHT_DUTY',
                    effectiveOn: '2026-09-07',
                    plannedEndOn: null,
                    actualEndOn: null,
                  },
                ]
              : [],
        })),
      },
    }),
  );
  await page.goto('/admin/bid-board');
  await page.getByRole('combobox', { name: 'Station or pool' }).selectOption('all');
  await expect(page.getByTestId('station-roster-card')).toHaveCount(6);
  await expect(page.getByText('46 seats in this shift')).toBeVisible();
  const station = page
    .getByTestId('station-roster-card')
    .filter({ has: page.getByRole('heading', { name: 'Station 7', exact: true }) });
  const next = station.getByRole('button', { name: 'Next', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(station.getByText('Synthetic Member 21', { exact: true })).toBeVisible();
  await station.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(station.getByText('Synthetic Member 21', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search this view').fill('Synthetic Member 44');
  await expect(page.getByText('Synthetic Member 44', { exact: true })).toBeVisible();
  await expect(page.getByText(/Light duty from/)).toBeVisible();
  await page.getByLabel('Search this view').clear();
  for (const width of [390, 646, 820, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 646 ? 698 : 1000 });
    await noOverflow(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`dense-board-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const open = page.getByRole('button', { name: 'Open admin navigation' });
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Admin navigation' });
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 22; i++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await open.click();
  await sheet.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('main')).toBeFocused();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`dashboard-${width}.png`), fullPage: true });
  }
  await page.getByRole('link', { name: 'Upcoming Bid', exact: true }).click();
  await expect(page).toHaveURL(/view=upcoming/);
  expect(errors).toEqual([]);
});

test('live override modal traps focus and cancels without a command', async ({ page }, info) => {
  await localOperator(page);
  let writes = 0;
  await page.route('**/api/admin/bid/override', (route) => {
    writes++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/admin/bid?session_id=annual-specialty-e2e');
  const aShift = page.getByRole('tab', { name: /^A Shift/ });
  const bShift = page.getByRole('tab', { name: /^B Shift/ });
  await expect(aShift).toHaveAttribute('id', 'shift-tab-A');
  await expect(bShift).toHaveAttribute('id', 'shift-tab-B');
  await aShift.focus();
  await page.keyboard.press('ArrowRight');
  await expect(bShift).toBeFocused();
  await expect(aShift).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(bShift).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'shift-tab-B');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(aShift).toHaveAttribute('aria-selected', 'true');
  const trigger = page.getByRole('button', { name: 'Override', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Admin override pick' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Force pick', exact: true })).toBeDisabled();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(writes).toBe(0);
  await trigger.click();
  await dialog.getByLabel('Reason').fill('Synthetic cancellation evidence');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toBe(0);
  await trigger.click();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`override-dialog-${width}.png`),
      fullPage: true,
    });
  }
});

test('public PIN validation retains labels, touch targets and reduced-motion behavior', async ({
  page,
}, info) => {
  await page.context().clearCookies();
  await page.route('**/api/pin', (route) =>
    route.fulfill({ status: 401, json: { error: 'incorrect_pin' } }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const pin = page.getByLabel('Access PIN');
  const submit = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(submit).toBeDisabled();
  await pin.fill('0000');
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pin).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#pin-error')).toHaveText('Incorrect PIN.');
  expect(await submit.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
    'Source Sans 3 Variable',
  );
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    for (const control of [pin, submit]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`pin-validation-${width}.png`), fullPage: true });
  }
});
