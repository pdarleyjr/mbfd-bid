import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('catalog import requires error-free review and preserves exact retry after response loss', async ({
  page,
}, testInfo) => {
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Local synthetic signing key required');
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
        emp: 'synthetic-import-operator',
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ json: { token: 'csrf_11111111-1111-1111-1111-111111111111' } }),
  );
  let previews = 0;
  const previewKeys: string[] = [];
  await page.route('**/api/admin/credential-imports/preview', (route) => {
    previews += 1;
    const previewKey = route.request().headers()['idempotency-key'] ?? '';
    previewKeys.push(previewKey);
    return route.fulfill({
      json: {
        previewKey,
        sourceRevision: previews,
        sourceHash: 'a'.repeat(64),
        ready: previews > 1,
        rows: [
          {
            name: 'Synthetic Qualification',
            fyPointsDefault: 4,
            previousPoints: 2,
            operation: 'UPDATE',
          },
        ],
        errors:
          previews === 1
            ? [{ rowNumber: 3, message: 'Synthetic invalid row requires review' }]
            : [],
      },
    });
  });
  const commits: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/credential-imports/commit', (route) => {
    commits.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON(),
    });
    if (commits.length === 1) return route.abort('failed');
    return route.fulfill({ json: { inserted: 0, updated: 1, unchanged: 0, replayed: true } });
  });
  await page.goto('/admin/credentials/import');
  await page.getByLabel('Catalog XLSX', { exact: true }).setInputFiles({
    name: 'synthetic-catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // UI transport fixture only; actual XLSX parsing is covered by worker integration tests.
    buffer: Buffer.from('synthetic mocked workbook transport'),
  });
  await page.getByRole('button', { name: 'Preview proposed changes', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Synthetic invalid row requires review' }),
  ).toBeVisible();
  await expect(page.getByLabel('Authoritative source reference', { exact: true })).toBeDisabled();
  expect(commits).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Regenerate review with current catalog', exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Synthetic invalid row requires review' }),
  ).toHaveCount(0);
  await page
    .getByLabel('Authoritative source reference', { exact: true })
    .fill('Synthetic approved catalog');
  await page
    .getByLabel('Review reason', { exact: true })
    .fill('Synthetic reviewed point correction');
  await page.getByRole('checkbox').check();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`catalog-import-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Apply reviewed catalog import', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /fetch|network/i })).toBeVisible();
  await expect(page.getByLabel('Review reason', { exact: true })).toHaveValue(
    'Synthetic reviewed point correction',
  );
  await page.getByRole('button', { name: 'Apply reviewed catalog import', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '0 created, 1 updated, 0 unchanged' }),
  ).toBeVisible();
  expect(commits).toHaveLength(2);
  expect(commits[0]).toEqual(commits[1]);
  expect(commits[0]?.key).not.toBe('');
  expect(new Set(previewKeys).size).toBe(2);
  expect(errors).toEqual([]);
});
