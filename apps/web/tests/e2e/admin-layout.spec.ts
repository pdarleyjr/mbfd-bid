/**
 * Task 16 E2E: Admin layout + role gate.
 *
 * - No JWT             → /login
 * - JWT role=member    → /lobby
 * - JWT role=admin     → renders /admin/page dashboard
 *
 * Worker API is mocked via page.route() — no live worker needed.
 */

import { type Page, expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGNING_KEY = process.env.JWT_SIGNING_KEY ?? 'test-signing-key-for-e2e-specs-only';

async function makeJwt(role: 'admin' | 'member') {
  const key = new TextEncoder().encode(SIGNING_KEY);
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 1,
    emp: '10001',
    role,
    rank: 'CPT',
    first_name: 'Admin',
    last_name: 'Tester',
    fresh_auth_at: nowSec,
  } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

async function setAuthCookies(page: Page, jwt: string) {
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
// Tests
// ---------------------------------------------------------------------------

test.describe('Admin gate — no JWT', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('navigating to /admin without JWT redirects to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: 'mbfd_pin',
        value: 'ok',
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('Admin gate — member JWT', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('navigating to /admin with role=member JWT redirects to /lobby', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY — cannot sign test JWT');
      return;
    }
    const jwt = await makeJwt('member');
    await setAuthCookies(page, jwt);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/lobby$/);
  });
});

test.describe('Admin dashboard — role=admin JWT', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('admin dashboard renders nav links', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY — cannot sign test JWT');
      return;
    }
    const jwt = await makeJwt('admin');
    await setAuthCookies(page, jwt);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Current Rosters', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'TeleStaff', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Members & Credentials', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bid Setup', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'AI Assist', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mock Bids', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Live Bid', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Results & Audit', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'System/Integrations', exact: true }),
    ).toBeVisible();
  });
});
