import { type Page, expect, test } from '@playwright/test';

async function expectCanonicalHubLogin(page: Page): Promise<void> {
  await expect(page).toHaveURL(/^https:\/\/staging\.mbfdhub\.com\/login$/);
  await expect(page.getByRole('heading', { name: 'MBFD Hub', exact: true })).toBeVisible();
  await expect(page.getByLabel('Employee ID')).toBeVisible();
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
    await page.goto('/');
    await page.getByLabel('Access PIN').fill(pin);
    await page.getByRole('button', { name: /continue/i }).click();
    await expectCanonicalHubLogin(page);
  });

  test('a /lobby request without PIN cookie redirects to /', async ({ page }) => {
    await page.goto('/lobby', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Lobby protection', () => {
  test('/lobby without PIN cookie redirects to /', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/lobby', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/$/);
  });

  test('/lobby with PIN cookie but no JWT reaches the canonical Hub login', async ({
    context,
    page,
  }) => {
    // This is a synthetic redirect contract check. Keep Bid's local redirect
    // chain real and intercept only the external Hub boundary; no Hub account
    // or live login page is required by a local browser test.
    const authorizations: URL[] = [];
    await page.route('https://staging.mbfdhub.com/auth/bid/authorize?**', async (route) => {
      authorizations.push(new URL(route.request().url()));
      await route.fulfill({
        status: 302,
        headers: { location: 'https://staging.mbfdhub.com/login' },
      });
    });
    await page.route('https://staging.mbfdhub.com/login', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>MBFD Hub</h1><p>Synthetic login destination fixture</p><label>Employee ID<input name="employee_id"></label></body></html>',
      }),
    );
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
    await page.goto('/lobby', { waitUntil: 'commit' });
    // The local streamed /lobby -> /login -> /api/auth/start chain must finish
    // before asserting the external fixture destination.
    await expect.poll(() => authorizations.length, { timeout: 15_000 }).toBe(1);
    const authorization = authorizations[0];
    expect(authorization?.origin).toBe('https://staging.mbfdhub.com');
    expect(authorization?.pathname).toBe('/auth/bid/authorize');
    expect(authorization?.searchParams.get('client_id')).toBe('bid');
    expect(authorization?.searchParams.get('redirect_uri')).toBe(
      'https://staging.bid.mbfdhub.com/api/auth/callback',
    );
    expect(authorization?.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expectCanonicalHubLogin(page);
    await expect(page.getByText('Synthetic login destination fixture')).toBeVisible();
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
