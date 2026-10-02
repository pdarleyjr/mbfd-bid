import type { Page } from '@playwright/test';

/** Reserved browser-only redirect fixture. This never contacts a real Hub or
 * verifies a real identity; authenticated production acceptance is separate. */
export async function installSyntheticHub(page: Page): Promise<void> {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.fallback();
    if (url.origin !== 'https://hub.test.invalid') return route.abort('blockedbyclient');
    if (url.pathname === '/auth/bid/authorize') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Synthetic Hub redirect</title><script>location.replace("/login")</script>',
      });
    }
    if (url.pathname === '/login') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><title>Synthetic Hub login</title><h1>MBFD Hub</h1><label>Employee ID<input name="employee_id"></label><p>Isolated browser fixture. No real sign-in is performed.</p></html>',
      });
    }
    return route.abort('blockedbyclient');
  });
}
