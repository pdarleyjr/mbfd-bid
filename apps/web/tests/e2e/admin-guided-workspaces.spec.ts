import { expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

test('Credential members open immediately in an accessible panel; menus collapse and pages stay bounded', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Local synthetic signing key required');
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: 901,
    hub_user_id: 901,
    member_id: 901,
    emp: 'synthetic-optimization',
    role: 'admin',
    security_version: 1,
    rank: 'CPT',
    first_name: 'Synthetic',
    last_name: 'Operator',
    fresh_auth_at: now,
    authz_checked_at: now,
  };
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(key));
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
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failSecond = true;
  const holders = Array.from({ length: 19 }, (_, i) => ({
    memberId: i + 1,
    employeeId: `SYN-${i + 1}`,
    firstName: 'Synthetic',
    lastName: `Holder ${String(i + 1).padStart(2, '0')}`,
    historyHref: `/admin/personnel/qualifications?member_id=${i + 1}`,
    legacyReference: false,
    status: 'active',
    expiresOn: null,
  }));
  await page.route('**/api/admin/credentials/*/holders', async (route) => {
    if (route.request().url().includes('/1/')) await pending;
    if (route.request().url().includes('/2/') && failSecond)
      return route.fulfill({ status: 503, json: { error: 'synthetic_connection_failure' } });
    return route.fulfill({ json: { holders } });
  });
  await page.goto('/admin/credentials');
  const trigger = page
    .getByRole('row')
    .filter({ hasText: 'Synthetic certification 01' })
    .getByRole('button', { name: 'View members' });
  await trigger.click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Loading credential members…')).toBeVisible();
  release();
  await expect(panel.getByText('Synthetic Holder 01', { exact: false })).toBeVisible();
  const bounds = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('Panel dimensions unavailable');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  await panel
    .getByRole('navigation', { name: 'members pages' })
    .getByRole('button', { name: 'Next' })
    .click();
  await expect(panel.getByText('Synthetic Holder 09', { exact: false })).toBeVisible();
  await panel.getByRole('searchbox').fill('SYN-19');
  await expect(panel.getByText('Synthetic Holder 19', { exact: false })).toBeVisible();
  await expect(panel.getByText('Synthetic Holder 09', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('credential-members-panel.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page
    .getByRole('row')
    .filter({ hasText: 'Synthetic certification 02' })
    .getByRole('button', { name: 'View members' })
    .click();
  await expect(panel.getByRole('button', { name: 'Retry loading members' })).toBeVisible({
    timeout: 15000,
  });
  failSecond = false;
  await panel.getByRole('button', { name: 'Retry loading members' }).click();
  await expect(panel.getByText('Synthetic Holder 01', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Close panel' }).click();
  const mobile = page.getByRole('button', { name: 'Open admin navigation' });
  if (await mobile.isVisible()) await mobile.click();
  await page
    .getByRole('button', { name: 'Collapse People menu', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page.getByRole('button', { name: 'Expand People menu', exact: true }).locator('visible=true'),
  ).toHaveAttribute('aria-expanded', 'false');
  await page
    .getByRole('button', { name: 'Expand People menu', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page.getByRole('button', { name: 'Collapse People menu', exact: true }).locator('visible=true'),
  ).toHaveAttribute('aria-expanded', 'true');
  if (await page.getByRole('button', { name: 'Close admin navigation' }).isVisible())
    await page.getByRole('button', { name: 'Close admin navigation' }).click();
  await page
    .getByRole('navigation', { name: 'credentials pages' })
    .getByRole('button', { name: 'Next' })
    .click();
  await expect(
    page.getByRole('row').filter({ hasText: 'Synthetic certification 09' }),
  ).toBeVisible();
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }));
  expect(size.width).toBeLessThanOrEqual(size.viewportWidth + 1);
  expect(size.height).toBeLessThanOrEqual(size.viewportHeight + 1);
  expect(errors).toEqual([]);
});
