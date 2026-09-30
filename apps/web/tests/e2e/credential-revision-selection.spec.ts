import path from 'node:path';
import { expect, test } from '@playwright/test';
import { signJwt } from '../../lib/jwt';

test('operator selects a workbook revision and the import receipt retains that choice', async ({
  page,
}) => {
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Local synthetic signing key required');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt(
    {
      sub: 901,
      hub_user_id: 901,
      member_id: 901,
      emp: 'synthetic-revisions',
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
  let body: Record<string, unknown> | undefined;
  const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';
  await page.route('**/api/auth/csrf', (route) => route.fulfill({ json: { token: csrfToken } }));
  await page.route('**/api/admin/targetsolutions/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/imports') && route.request().method() === 'POST') {
      expect(route.request().headers()['x-mbfd-csrf']).toBe(csrfToken);
      body = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'synthetic-selected-revision' } });
    }
    if (pathname.endsWith('/review')) return route.fulfill({ json: { reviewed: 1 } });
    if (pathname.endsWith('/imports')) return route.fulfill({ json: { imports: [] } });
    if (pathname.endsWith('/catalog'))
      return route.fulfill({ json: { credentials: [], mappings: [] } });
    if (pathname.endsWith('/names')) return route.fulfill({ json: { names: [] } });
    return route.fulfill({
      json: {
        id: 'synthetic-selected-revision',
        filename: 'credential-revisions.xlsx',
        observed_on: '2026-09-29',
        status: 'reviewed',
        source_row_count: 1,
        unique_row_count: 1,
        coverage: {
          expirationDates: true,
          issueDates: true,
          explicitStatus: false,
          activeOnly: false,
        },
        counts: { NEW_QUALIFICATION: 1 },
        rows: [],
        source_receipt: {
          ...(body?.source_receipt as object),
          observed_at: '2026-09-30T11:00:00.000Z',
          approved_at: null,
        },
      },
    });
  });
  await page.goto('/admin/targetsolutions');
  await page
    .getByLabel('Credential report')
    .setInputFiles(path.resolve('tests/fixtures/credential-revisions.xlsx'));
  const revisions = page.getByLabel('Credential revision', { exact: true });
  await expect(revisions).toHaveValue('2026_BID_Credentials_Version_4_');
  await expect(revisions).toContainText('Version 4 — Latest in this workbook');
  await revisions.selectOption('2026_BID_Credentials_Version_1_');
  await expect(revisions).toHaveValue('2026_BID_Credentials_Version_1_');
  await revisions.selectOption('2026_BID_Credentials_Version_4_');
  await page.getByLabel('Report date').fill('2026-09-29');
  await page.getByRole('button', { name: 'Upload and compare', exact: true }).click();
  await expect(page.getByText('File saved and compared.', { exact: false })).toBeVisible();
  expect(body?.source_receipt).toMatchObject({
    selected_sheet: '2026_BID_Credentials_Version_4_',
    source_revision: 4,
    row_count: 1,
    unique_employee_count: 1,
    source_filename: 'credential-revisions.xlsx',
    workbook_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(body?.csv).toContain('2028-12-01,2026-12-01');
  await expect(page.getByText('Saved source:', { exact: false })).toContainText('Version 4');
  await expect(page.getByText('SHA-256:', { exact: false })).toBeVisible();
});
