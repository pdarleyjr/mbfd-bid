/**
 * Task 17 E2E: Admin members list + member detail.
 *
 * Server fetches use the synthetic loopback Worker fixture — no live worker needed.
 */

import { expect, test } from '@playwright/test';
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

test.describe('Admin members list', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('renders members table with mock data', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY');
      return;
    }

    const jwt = await makeAdminJwt();
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

    await page.goto('/admin/members');
    await expect(page.getByRole('cell', { name: 'Smith' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Jones' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Reyes' })).toBeVisible();
  });

  test('member detail page renders profile', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY');
      return;
    }

    const jwt = await makeAdminJwt();
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

    await page.goto('/admin/members/1');
    await expect(page.getByRole('heading', { name: 'Smith, Alice', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('10001')).toBeVisible();
  });

  test('member detail 404 shows not found message', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY');
      return;
    }

    const jwt = await makeAdminJwt();
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

    await page.goto('/admin/members/9999');
    await expect(page.getByRole('main').getByText(/not found/i)).toBeVisible();
  });
});
