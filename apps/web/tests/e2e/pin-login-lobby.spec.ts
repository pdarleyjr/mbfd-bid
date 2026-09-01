import { type Page, expect, test } from '@playwright/test';

async function interceptHubAuthorization(page: Page): Promise<void> {
  await page.route('https://www.mbfdhub.com/auth/bid/authorize**', (route) =>
    route.fulfill({ status: 200, body: 'Canonical MBFD Hub authentication' }),
  );
}

async function expectCanonicalHubAuthorization(page: Page): Promise<void> {
  await expect(page).toHaveURL(/^https:\/\/www\.mbfdhub\.com\/auth\/bid\/authorize\?/);
  const authorize = new URL(page.url());
  expect(authorize.searchParams.get('client_id')).toBe('bid');
  expect(authorize.searchParams.get('redirect_uri')).toBe(
    'https://staging.bid.mbfdhub.com/api/auth/callback',
  );
  expect(authorize.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
}

test.describe('PIN gate', () => {
  test('rejects an incorrect PIN', async ({ page }) => {
    const apiBase = process.env.E2E_TEST_API_BASE;
    const incorrectPin = process.env.E2E_TEST_INCORRECT_PIN;
    if (!apiBase || !incorrectPin) {
      test.skip(true, 'Requires controlled E2E API and an explicitly supplied incorrect test PIN');
      return;
    }
    await page.goto('/');
    await page.getByLabel('Access PIN').fill(incorrectPin);
    await page.getByRole('button', { name: /continue/i }).click();
    // Next.js injects a global <div role="alert" id="__next-route-announcer__">,
    // so target our own form-level error by id to avoid the strict-mode collision.
    await expect(page.locator('#pin-error')).toHaveText(/incorrect/i);
  });

  test('accepts an explicitly provided E2E test PIN and federates to Hub', async ({ page }) => {
    const apiBase = process.env.E2E_TEST_API_BASE;
    const pin = process.env.E2E_TEST_PIN;
    if (!apiBase || !pin) {
      test.skip(
        true,
        'Requires controlled E2E API and a noncommitted E2E_TEST_PIN configured by the test environment',
      );
      return;
    }
    await interceptHubAuthorization(page);
    await page.goto('/');
    await page.getByLabel('Access PIN').fill(pin);
    await page.getByRole('button', { name: /continue/i }).click();
    await expectCanonicalHubAuthorization(page);
  });

  test('a /lobby request without PIN cookie redirects to /', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Lobby protection', () => {
  test('/lobby without PIN cookie redirects to /', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/lobby');
    await expect(page).toHaveURL(/\/$/);
  });

  test('/lobby with PIN cookie but no JWT federates to Hub without a password form', async ({
    context,
    page,
  }) => {
    await interceptHubAuthorization(page);
    await context.clearCookies();
    await context.addCookies([
      {
        name: 'mbfd_pin',
        value: 'ok',
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto('/lobby');
    await expectCanonicalHubAuthorization(page);
  });
});

test.describe('Full happy path (JWT in cookie)', () => {
  test('PIN → JWT cookie → lobby greets the member', async ({ context, page }) => {
    // SKIP in CI until /lobby fragility is resolved (W10 + W14).
    // Runs locally when JWT_SIGNING_KEY is set and E2E_FULL=1.
    test.skip(
      !process.env.E2E_JWT || (!!process.env.CI && !process.env.E2E_FULL),
      'Skipped in CI pending /lobby + Next 15 RC stabilization (W14)',
    );
    const jwt = process.env.E2E_JWT as string;
    // Set PIN cookie + pre-signed JWT cookie directly
    await context.clearCookies();
    await context.addCookies([
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
    await page.goto('/lobby');
    await expect(page.getByRole('heading', { name: /lobby/i })).toBeVisible();
    await expect(page.getByText('Peter')).toBeVisible();
  });
});
