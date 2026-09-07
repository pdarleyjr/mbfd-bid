/**
 * Task 18 E2E: Admin positions + rules viewers.
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

test.describe('Admin positions viewer', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('renders positions grouped by shift and station', async ({ page }) => {
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

    await page.goto(
      '/admin/positions?year=2026&rule_book_version=2026.1&template_version=2026.1&configuration_revision=1',
    );
    // Should show shift group headings
    await expect(page.getByRole('main').getByText('Shift A')).toBeVisible();
    await expect(page.getByRole('main').getByText('Shift B')).toBeVisible();
    // Station within shift
    await expect(page.getByRole('main').getByText('Station 1')).toBeVisible();
    await expect(page.getByRole('main').getByText('Station 2')).toBeVisible();
    // Position IDs shown
    await expect(page.getByRole('main').getByText('A-01-FF-1')).toBeVisible();
  });
});

test.describe('Admin rules viewer', () => {
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'Skip in CI without E2E_FULL');

  test('renders rules tree with rule_book_version and position nodes', async ({ page }) => {
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

    await page.goto(
      '/admin/rules?year=2026&rule_book_version=2026.1&template_version=2026.1&configuration_revision=1',
    );
    // Should show rule book version
    await expect(page.getByRole('heading', { name: /^2026\.1\s*\(3 positions\)$/ })).toBeVisible();
    // Position IDs shown in tree
    await expect(page.getByRole('main').getByText('A-01-FF-1')).toBeVisible();
    await expect(page.getByRole('main').getByText('A-01-LT-1')).toBeVisible();
  });
});
