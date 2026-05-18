import { expect, test } from '@playwright/test';

test.describe('PIN gate', () => {
  test('rejects an incorrect PIN', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Access PIN').fill('9999');
    await page.getByRole('button', { name: /continue/i }).click();
    // Next.js injects a global <div role="alert" id="__next-route-announcer__">,
    // so target our own form-level error by id to avoid the strict-mode collision.
    await expect(page.locator('#pin-error')).toHaveText(/incorrect/i);
  });

  test('accepts PIN 2300 and forwards to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Access PIN').fill('2300');
    await page.getByRole('button', { name: /continue/i }).click();
    // /login doesn't exist yet (Task 9) — but middleware should still try to render or redirect.
    // For Task 7 acceptance, we just confirm we navigated away from '/'.
    await expect(page).not.toHaveURL(/^http:\/\/localhost:3000\/$/);
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

  test('/lobby with PIN cookie but no JWT redirects to /login', async ({ context, page }) => {
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
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('Full happy path (JWT in cookie)', () => {
  test('PIN → JWT cookie → lobby greets the member', async ({ context, page }) => {
    const jwt = process.env.E2E_JWT;
    if (!jwt) {
      test.skip(true, 'JWT_SIGNING_KEY not set for global-setup');
      return;
    }
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
