/**
 * Task 19 E2E: Admin import upload UIs.
 *
 * Worker API is mocked via page.route() — no live worker needed.
 * These tests require a running Next.js dev server at localhost:3000.
 */

import { type Page, expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

const SIGNING_KEY = process.env.JWT_SIGNING_KEY ?? 'test-signing-key-for-e2e-specs-only';

async function makeAdminJwt() {
  const key = new TextEncoder().encode(SIGNING_KEY);
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 1,
    hub_user_id: 1,
    member_id: 1,
    emp: '10001',
    role: 'admin',
    security_version: 1,
    rank: 'CPT',
    first_name: 'Admin',
    last_name: 'Tester',
    fresh_auth_at: nowSec,
    authz_checked_at: nowSec,
  } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

async function setAdminCookies(page: Page, jwt: string) {
  await page.context().clearCookies();
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
}

// ---------------------------------------------------------------------------
// Members import
// ---------------------------------------------------------------------------

test.describe('Retired admin members import', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('does not expose a legacy upload and directs the operator to controlled workflows', async ({
    page,
  }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY');
      return;
    }

    const jwt = await makeAdminJwt();
    await setAdminCookies(page, jwt);

    await page.goto('/admin/members/import');

    await expect(
      page.getByRole('heading', { name: /legacy member import retired/i }),
    ).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /open telestaff reconciliation/i }),
    ).toHaveAttribute('href', '/admin/telestaff');
    await expect(page.getByRole('link', { name: /open personnel lifecycle/i })).toHaveAttribute(
      'href',
      '/admin/personnel',
    );
  });
});

// ---------------------------------------------------------------------------
// Credentials import
// ---------------------------------------------------------------------------

test.describe('Admin qualification catalog import', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) throw new Error('Explicit isolated test key required');
    await setAdminCookies(page, await makeAdminJwt());
    await page.route('**/api/auth/csrf', (route) =>
      route.fulfill({ json: { token: 'csrf_11111111-1111-1111-1111-111111111111' } }),
    );
  });

  test('legacy layout sends reviewed metadata and reports recorded import results', async ({
    page,
  }) => {
    let previewBody = '';
    await page.route('**/api/admin/credential-imports/preview', (route) => {
      previewBody = route.request().postData() ?? '';
      return route.fulfill({
        json: {
          previewKey: 'synthetic-preview',
          sourceRevision: 1,
          sourceHash: 'a'.repeat(64),
          ready: true,
          rows: [
            {
              name: 'Synthetic Qualification',
              operation: 'CREATE',
              fyPointsDefault: 0,
              previousPoints: null,
            },
          ],
          errors: [],
        },
      });
    });
    let committed: Record<string, unknown> | null = null;
    await page.route('**/api/admin/credential-imports/commit', (route) => {
      committed = route.request().postDataJSON();
      return route.fulfill({ json: { inserted: 1, updated: 0, unchanged: 0 } });
    });
    await page.goto('/admin/credentials/import');
    await expect(
      page.getByRole('heading', { name: 'Import Qualification Catalog', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Import layout', exact: true })
      .selectOption('legacy_wide_matrix');
    await page.getByRole('main').getByLabel('Leading metadata columns', { exact: true }).fill('3');
    await page
      .getByRole('main')
      .getByLabel('Catalog XLSX', { exact: true })
      .setInputFiles({
        name: 'synthetic-layout.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from('mocked transport; parser tested in Worker'),
      });
    await page.getByRole('button', { name: 'Preview proposed changes', exact: true }).click();
    await expect(
      page.getByRole('cell', { name: 'Synthetic Qualification', exact: true }),
    ).toBeVisible();
    expect(previewBody).toContain('legacy_wide_matrix');
    expect(previewBody).toContain('metadata_columns');
    expect(previewBody).toContain('3');
    expect(committed).toBeNull();
    await page
      .getByRole('main')
      .getByLabel('Authoritative source reference', { exact: true })
      .fill('Synthetic approved source');
    await page
      .getByRole('main')
      .getByLabel('Review reason', { exact: true })
      .fill('Synthetic catalog review');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Apply reviewed catalog import', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '1 created, 0 updated, 0 unchanged' }),
    ).toBeVisible();
    expect(committed).toMatchObject({
      preview_key: 'synthetic-preview',
      expected_source_revision: 1,
    });
  });

  test('row errors remain visible and prevent importing an invalid preview', async ({ page }) => {
    let writes = 0;
    await page.route('**/api/admin/credential-imports/commit', (route) => {
      writes++;
      return route.abort();
    });
    await page.route('**/api/admin/credential-imports/preview', (route) =>
      route.fulfill({
        json: {
          previewKey: 'synthetic-invalid',
          sourceRevision: 1,
          sourceHash: 'b'.repeat(64),
          ready: false,
          rows: [],
          errors: [
            { rowNumber: 3, message: 'Missing qualification name' },
            { rowNumber: 7, message: 'Invalid default points' },
          ],
        },
      }),
    );
    await page.goto('/admin/credentials/import');
    await page
      .getByRole('main')
      .getByLabel('Catalog XLSX', { exact: true })
      .setInputFiles({
        name: 'synthetic-errors.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from('mocked transport'),
      });
    await page.getByRole('button', { name: 'Preview proposed changes', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Missing qualification name' }),
    ).toContainText('Invalid default points');
    await expect(
      page.getByRole('main').getByLabel('Authoritative source reference', { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Apply reviewed catalog import', exact: true }),
    ).toBeDisabled();
    expect(writes).toBe(0);
  });
});
