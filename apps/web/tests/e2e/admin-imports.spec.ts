/**
 * Task 19 E2E: Admin import upload UIs.
 *
 * Worker API is mocked via page.route() — no live worker needed.
 * These tests require a running Next.js dev server at localhost:3000.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

test.describe('Admin credentials import', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('renders upload form with mode toggle and shows results', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY');
      return;
    }

    const jwt = await makeAdminJwt();
    await setAdminCookies(page, jwt);

    await page.route('**/api/admin/credentials/import**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inserted: 150, updated: 10, errors: [] }),
      });
    });

    await page.goto('/admin/credentials/import');

    await expect(page.getByRole('heading', { name: /import credentials/i })).toBeVisible();

    // Mode select should be present
    const modeSelect = page.locator('select[name="mode"]');
    await expect(modeSelect).toBeVisible();

    // Select legacy_wide_matrix mode
    await modeSelect.selectOption('legacy_wide_matrix');

    const fileInput = page.locator('input[type="file"]');
    const fixtureXlsxPath = path.resolve(__dirname, '../fixtures/credentials-fixture.xlsx');
    await fileInput.setInputFiles(fixtureXlsxPath);

    await page.getByRole('button', { name: /upload/i }).click();

    // Result panel
    await expect(page.getByText('150')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('10')).toBeVisible();
  });

  test('shows expandable error list when errors returned', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY');
      return;
    }

    const jwt = await makeAdminJwt();
    await setAdminCookies(page, jwt);

    await page.route('**/api/admin/credentials/import**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          inserted: 5,
          updated: 0,
          errors: [
            { rowNumber: 3, raw: null, message: 'Missing employee_id' },
            { rowNumber: 7, raw: null, message: 'Unknown credential type' },
          ],
        }),
      });
    });

    await page.goto('/admin/credentials/import');

    const fileInput = page.locator('input[type="file"]');
    const fixtureXlsxPath = path.resolve(__dirname, '../fixtures/credentials-fixture.xlsx');
    await fileInput.setInputFiles(fixtureXlsxPath);
    await page.getByRole('button', { name: /upload/i }).click();

    // Error count shown
    await expect(page.getByText('2')).toBeVisible({ timeout: 15_000 });

    // Expand errors
    await page.getByText(/show errors/i).click();
    await expect(page.getByText(/missing employee_id/i)).toBeVisible();
    await expect(page.getByText(/unknown credential type/i)).toBeVisible();
  });
});
