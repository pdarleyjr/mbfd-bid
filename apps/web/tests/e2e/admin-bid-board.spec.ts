import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('independent board views preserve source boundaries at phone, tablet and desktop widths', async ({
  page,
}, testInfo) => {
  const key = process.env.JWT_SIGNING_KEY;
  expect(key, 'An explicit local test signing key is required').toBeTruthy();
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return ['localhost', '127.0.0.1'].includes(host) ? route.continue() : route.abort();
  });
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-board-operator',
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
    .sign(
      /^[0-9a-f]{64}$/i.test(key ?? '')
        ? Buffer.from(key ?? '', 'hex')
        : new TextEncoder().encode(key),
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let fail = false;
  let currentReads = 0;
  let previousReads = 0;
  let latestSession = 'synthetic-official-completion';
  let resolverReads = 0;
  await page.route('**/api/admin/annual-plan/official-sources', (route) => {
    resolverReads += 1;
    return route.fulfill({
      json: {
        sources: [...new Set([latestSession, 'synthetic-official-completion'])].map(
          (sessionId) => ({ sessionId, year: 2027, completedAtMs: now * 1000 }),
        ),
      },
    });
  });
  await page.route('**/api/admin/annual-plan', (route) =>
    route.fulfill({ json: { plans: [{ year: 2027, ruleBookVersion: '2027.1' }] } }),
  );
  await page.route('**/api/admin/bid-board?**', async (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    if (view === 'current') currentReads += 1;
    if (view === 'previous') previousReads += 1;
    if (fail) {
      await route.fulfill({ status: 503, json: { error: 'synthetic_service_unavailable' } });
      return;
    }
    const source = {
      label: `Synthetic ${view} fixture`,
      year: view === 'current' ? null : 2027,
      asOf: view === 'current' ? '2026-09-06' : null,
      sessionId: view === 'previous' ? url.searchParams.get('session') : null,
      templateVersion: null,
      ruleBookVersion: null,
      configurationRevision: null,
      ruleBookRevision: null,
      completionRevision: view === 'previous' ? 12 : null,
    };
    const seat = {
      id: 'synthetic-seat',
      shift: url.searchParams.get('shift'),
      station: '7',
      unit: 'Engine 7',
      position: 'Firefighter',
      rank: 'FF',
    };
    const details =
      view === 'previous'
        ? {
            award: {
              memberId: 101,
              name:
                url.searchParams.get('session') === 'synthetic-next-completion'
                  ? 'Newly Completed Winner'
                  : 'Historical Winner',
              nameSource: 'frozen',
            },
            aDay: 'G1',
          }
        : view === 'current'
          ? {
              occupancy: 'occupied',
              occupant: { memberId: 202, name: 'Current Occupant', nameSource: 'current' },
              assignmentOrigin: 'ADMIN_TRANSFER',
              temporaryContext: [],
            }
          : { participation: 'BIDDABLE', mapping: 'review_required' };
    await route.fulfill({
      json: {
        view,
        lifecycle: view === 'previous' ? 'COMPLETE' : view === 'current' ? 'CURRENT' : 'DRAFT',
        generatedAt: new Date().toISOString(),
        source,
        notice: null,
        seats: [{ ...seat, ...details }],
      },
    });
  });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin/bid-board?view=previous&shift=A');
    await expect(page.getByText('Historical Winner', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    if (width === 390) {
      const toggle = page.getByRole('button', { name: 'Open admin navigation', exact: true });
      await toggle.click();
      await expect(page.locator('#admin-mobile-navigation a').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await toggle.click();
      await page
        .locator('#admin-mobile-navigation')
        .getByRole('link', { name: 'Bid Board', exact: true })
        .click();
      await expect(page.locator('#admin-mobile-navigation')).toBeHidden();
      await expect(page.getByText('Current Occupant', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Previous Bid', exact: true }).click();
      await expect(page.getByText('Historical Winner', { exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Current Staffing', exact: true }).click();
    await expect(page.getByText('Current Occupant', { exact: true })).toBeVisible();
    await expect(page.getByText('Historical Winner', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Upcoming Bid', exact: true }).click();
    await page.getByRole('combobox', { name: 'Annual plan', exact: true }).selectOption('2027');
    await expect(page.getByText('Biddable', { exact: true })).toBeVisible();
    await expect(page.getByText('Current Occupant', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Historical Winner', { exact: true })).toHaveCount(0);
    await page.getByLabel('Search this view', { exact: true }).fill('absent');
    await expect(page.getByText('No seats in this view and selection.')).toBeVisible();
    await page.getByLabel('Search this view', { exact: true }).clear();
    await page.screenshot({ path: testInfo.outputPath(`upcoming-${width}.png`), fullPage: true });
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('main *'))
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            width: element.getBoundingClientRect().width,
          }))
          .slice(0, 10),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  const sidebar = page.getByTestId('admin-sidebar');
  await page.getByRole('button', { name: 'Collapse admin sidebar', exact: true }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await expect(sidebar.getByRole('link', { name: 'Prepare Next Bid', exact: true })).toBeVisible();
  await sidebar.getByRole('link', { name: 'Prepare Next Bid', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(
    sidebar.getByRole('link', { name: 'Prepare Next Bid', exact: true }).locator('span'),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('compact-navigation.png'), fullPage: true });
  await page.getByRole('button', { name: 'Expand admin sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Current Staffing', exact: true }).click();
  await expect(page.getByText('Current Occupant', { exact: true })).toBeVisible();
  const immutableReads = previousReads;
  const beforeFocus = currentReads;
  // Control cache age only after real hydration and initial network reads.
  // Startup uses the real clock; these assertions exercise cache freshness.
  const cacheClock = Date.now();
  await page.clock.setFixedTime(new Date(cacheClock + 31_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => currentReads, { timeout: 10_000 }).toBeGreaterThan(beforeFocus);
  expect(previousReads).toBe(immutableReads);
  fail = true;
  const before = currentReads;
  await page.clock.setFixedTime(new Date(cacheClock + 62_000));
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => currentReads, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Showing the last successful data' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Current Occupant', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Previous Bid', exact: true }).click();
  await expect(page.getByText('Historical Winner', { exact: true })).toBeVisible();
  latestSession = 'synthetic-next-completion';
  const beforeResolution = resolverReads;
  await page.clock.setFixedTime(new Date(cacheClock + 93_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => resolverReads).toBeGreaterThan(beforeResolution);
  await expect(page.getByText('Newly Completed Winner', { exact: true })).toBeVisible();
  const completedReads = previousReads;
  await page
    .getByRole('combobox', { name: 'Completed official bid', exact: true })
    .selectOption('synthetic-official-completion');
  await expect(page.getByText('Historical Winner', { exact: true })).toBeVisible();
  expect(previousReads).toBe(completedReads);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /Prepare Next Bid/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: /Bid Board/ })).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
