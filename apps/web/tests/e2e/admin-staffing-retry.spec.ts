import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('seat creation retains its generated identity through response loss and refreshes the dated projection', async ({
  page,
}) => {
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Explicit local synthetic signing key required');
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
        emp: 'synthetic-staffing-operator',
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
  const attempts: { key: string; csrf: string; body: unknown }[] = [];
  // The app deliberately trusts only its configured public origin. Supply
  // synthetic staging metadata to the loopback proxy; no request leaves localhost.
  const fixtureHeaders = (headers: Record<string, string>) => ({
    ...headers,
    origin: 'https://staging.bid.mbfdhub.com',
    'sec-fetch-site': 'same-origin',
  });
  await page.route('**/api/auth/csrf', async (route) => {
    const result = await route.fetch({ headers: fixtureHeaders(route.request().headers()) });
    expect(result.status()).toBe(200);
    return route.fulfill({ response: result });
  });
  await page.route('**/api/admin/personnel/changes', async (route) => {
    attempts.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      csrf: route.request().headers()['x-mbfd-csrf'] ?? '',
      body: route.request().postDataJSON(),
    });
    // Exercise the real same-origin/CSRF proxy and loopback Worker fixture.
    // Only delivery to the browser is lost after the first accepted response.
    const result = await route.fetch({ headers: fixtureHeaders(route.request().headers()) });
    expect(result.status(), await result.text()).toBe(attempts.length === 1 ? 201 : 200);
    if (attempts.length === 1) return route.abort('failed');
    return route.fulfill({ response: result });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/admin/staffing-structure?as_of=2027-01-01');
  await page.getByLabel('Station', { exact: true }).fill('7');
  await page.getByLabel('Unit', { exact: true }).fill('Synthetic Engine 7');
  await page.getByLabel('Position', { exact: true }).fill('Synthetic Firefighter');
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic approved Station 7 fixture');
  await page.getByRole('button', { name: 'Create authorized seat', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Position', { exact: true })).toHaveValue('Synthetic Firefighter');
  await page.getByRole('button', { name: 'Create authorized seat', exact: true }).click();
  await expect(
    page.getByText(
      'Authorized staffing seat created. Effective-dated projections are refreshing.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retire seat', exact: true })).toHaveCount(1);
  await expect(page.getByRole('cell').filter({ hasText: 'Synthetic Engine 7' })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.key).not.toBe('');
  expect(attempts[0]?.csrf).toMatch(/^csrf_/);
  expect(attempts[0]?.key).toBe(attempts[1]?.key);
  expect(attempts[0]?.body).toEqual(attempts[1]?.body);
});
