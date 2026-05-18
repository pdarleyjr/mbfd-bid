/**
 * Task 18 E2E: Admin positions + rules viewers.
 *
 * Worker API is mocked via page.route() — no live worker needed.
 */

import { expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

const SIGNING_KEY = process.env.JWT_SIGNING_KEY ?? 'test-signing-key-for-e2e-specs-only';

async function makeAdminJwt() {
  const key = new TextEncoder().encode(SIGNING_KEY);
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 1 as unknown as string,
    emp: '10001',
    role: 'admin',
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

const MOCK_POSITIONS = [
  {
    id: 'A-01-FF-1',
    template_version: '2026.1',
    shift: 'A',
    station: 'Station 1',
    division: 'Combat',
    unit: 'E1',
    rank_required: 'FF',
    position_name: 'Engine Driver',
    is_floating: false,
    is_vacant_by_design: false,
    is_excluded_from_count: false,
  },
  {
    id: 'A-01-LT-1',
    template_version: '2026.1',
    shift: 'A',
    station: 'Station 1',
    division: 'Combat',
    unit: 'E1',
    rank_required: 'LT',
    position_name: 'Company Officer',
    is_floating: false,
    is_vacant_by_design: false,
    is_excluded_from_count: false,
  },
  {
    id: 'B-02-FF-1',
    template_version: '2026.1',
    shift: 'B',
    station: 'Station 2',
    division: 'Combat',
    unit: 'E2',
    rank_required: 'FF',
    position_name: 'Engine Driver',
    is_floating: false,
    is_vacant_by_design: false,
    is_excluded_from_count: false,
  },
];

const MOCK_RULES = [
  {
    id: 1,
    ruleBookVersion: '2026.1',
    positionId: 'A-01-FF-1',
    templateVersion: '2026.1',
    requiredCriteria: { certs: ['EMT'] },
    pointsPreference: { weight: 'rsc_seniority' },
    tieBreakChain: ['rsc_seniority', 'hired_at'],
    notes: null,
  },
  {
    id: 2,
    ruleBookVersion: '2026.1',
    positionId: 'A-01-LT-1',
    templateVersion: '2026.1',
    requiredCriteria: { certs: ['EMT', 'Paramedic'] },
    pointsPreference: { weight: 'rsc_seniority' },
    tieBreakChain: ['rsc_seniority'],
    notes: 'Lieutenant rule',
  },
  {
    id: 3,
    ruleBookVersion: '2026.1',
    positionId: 'B-02-FF-1',
    templateVersion: '2026.1',
    requiredCriteria: { certs: ['EMT'] },
    pointsPreference: null,
    tieBreakChain: ['rsc_seniority'],
    notes: null,
  },
];

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

    await page.route('**/api/admin/positions*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ positions: MOCK_POSITIONS, templateVersion: '2026.1', count: 3 }),
      });
    });

    await page.goto('/admin/positions');
    // Should show shift group headings
    await expect(page.getByText('Shift A')).toBeVisible();
    await expect(page.getByText('Shift B')).toBeVisible();
    // Station within shift
    await expect(page.getByText('Station 1')).toBeVisible();
    await expect(page.getByText('Station 2')).toBeVisible();
    // Position IDs shown
    await expect(page.getByText('A-01-FF-1')).toBeVisible();
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

    await page.route('**/api/admin/rules*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rules: MOCK_RULES, ruleBookVersion: '2026.1', count: 3 }),
      });
    });

    await page.goto('/admin/rules');
    // Should show rule book version
    await expect(page.getByText('2026.1')).toBeVisible();
    // Position IDs shown in tree
    await expect(page.getByText('A-01-FF-1')).toBeVisible();
    await expect(page.getByText('A-01-LT-1')).toBeVisible();
  });
});
