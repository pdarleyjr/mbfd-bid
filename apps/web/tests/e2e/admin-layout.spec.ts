/**
 * Task 16 E2E: Admin layout + role gate.
 *
 * - No JWT             → canonical Hub authorization
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
    hub_user_id: 1,
    member_id: 1,
    emp: '10001',
    role,
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

  test('navigating to /admin without JWT reaches the canonical staging Hub login', async ({
    page,
  }) => {
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
    await page.goto('/admin', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/^https:\/\/staging\.mbfdhub\.com\/login$/);
    await expect(page.getByRole('heading', { name: 'MBFD Hub', exact: true })).toBeVisible();
    await expect(page.getByLabel('Employee ID')).toBeVisible();
  });

  test('the Administrator Guide is not public when no JWT is present', async ({ page }) => {
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
    await page.goto('/admin/guide', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/^https:\/\/staging\.mbfdhub\.com\/login$/);
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
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const mobile = page.getByRole('button', { name: 'Open admin navigation' });
    if (await mobile.isVisible()) await mobile.click();
    const nav = page
      .getByRole('navigation', { name: 'Admin navigation', exact: true })
      .locator('visible=true');
    for (const name of [
      'Today',
      'People',
      'Staffing',
      'Annual Bid',
      'History & Reports',
      'Docs & Manual',
      'Settings',
    ]) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await nav.getByRole('button', { name: 'Expand Staffing menu' }).click();
    await expect(nav.getByRole('link', { name: 'Current assignments', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: 'Collapse Staffing menu' }).click();
    await expect(nav.getByRole('link', { name: 'Current assignments', exact: true })).toHaveCount(
      0,
    );
  });

  test('an admin can open the searchable Administrator Guide', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY — cannot sign test JWT');
      return;
    }
    const jwt = await makeJwt('admin');
    await setAuthCookies(page, jwt);
    await page.goto('/admin/guide');
    await expect(
      page.getByRole('heading', { name: 'Docs & Administrator Manual', exact: true }),
    ).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Search the Administrator Guide' });
    await search.fill('hold presentation');
    await expect(
      page.getByRole('heading', { name: 'Live Presentation', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Show how to use it', exact: true }).click();
    await expect(
      page.getByText('HOLD DISPLAY is not the same as pausing Bid execution'),
    ).toBeVisible();
  });

  test('a 390px viewport exposes an accessible admin navigation replacement', async ({ page }) => {
    if (!process.env.JWT_SIGNING_KEY) {
      test.skip(true, 'No JWT_SIGNING_KEY — cannot sign test JWT');
      return;
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const jwt = await makeJwt('admin');
    await setAuthCookies(page, jwt);
    await page.goto('/admin');

    const mobileNavigation = page.locator('#admin-mobile-navigation');
    const toggle = page.locator('button[aria-controls="admin-mobile-navigation"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(mobileNavigation).toBeHidden();

    await toggle.focus();
    await page.keyboard.press('Enter');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(mobileNavigation).toBeVisible();
    await expect(
      mobileNavigation.getByRole('link', { name: 'Staffing', exact: true }),
    ).toBeVisible();
  });
});
