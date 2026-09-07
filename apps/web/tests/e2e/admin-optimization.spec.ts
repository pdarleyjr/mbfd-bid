import { expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

test('Docs, contextual help and reviewed credential upload work on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Local synthetic signing key required');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    sub: 901,
    hub_user_id: 901,
    member_id: 901,
    emp: 'synthetic-optimization',
    role: 'admin',
    security_version: 1,
    rank: 'CPT',
    first_name: 'Synthetic',
    last_name: 'Operator',
    fresh_auth_at: now,
    authz_checked_at: now,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(key));
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
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/admin/docs');
  await expect(
    page.getByRole('heading', { name: 'Docs & Administrator Manual', exact: true }),
  ).toBeVisible();
  const pdf = page.locator('a[download][href$=".pdf"]');
  await expect(pdf).toBeVisible();
  const response = await page.request.get('/manual/MBFD-Bid-Administrator-Manual.pdf');
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.screenshot({ path: testInfo.outputPath('docs.png'), fullPage: true });
  let uploaded = false;
  let applied = false;
  let applyCalls = 0;
  const detail = () => ({
    id: 'synthetic-import',
    filename: 'synthetic.csv',
    observed_on: '2026-09-07',
    status: 'reviewed',
    source_row_count: 2,
    unique_row_count: 2,
    coverage: {
      expirationDates: false,
      issueDates: false,
      explicitStatus: false,
      activeOnly: true,
    },
    counts: applied
      ? { APPLIED: 1, UNKNOWN_MEMBER: 1 }
      : { NEW_QUALIFICATION: 1, UNKNOWN_MEMBER: 1 },
    rows: [
      {
        id: 'row-1',
        classification: 'NEW_QUALIFICATION',
        member_id: 901,
        credential_id: 10,
        applied_at: applied ? Date.now() : null,
        source: {
          employeeId: 'synthetic-901',
          firstName: 'Synthetic',
          lastName: 'Member',
          credentialName: 'Synthetic certification',
          status: 'active',
          effectiveOn: null,
          expiresOn: null,
        },
        before: { current: null },
      },
      {
        id: 'row-2',
        classification: 'UNKNOWN_MEMBER',
        member_id: null,
        credential_id: 10,
        applied_at: null,
        source: {
          employeeId: 'unmatched-902',
          firstName: 'Synthetic',
          lastName: 'Unmatched',
          credentialName: 'Synthetic certification',
          status: 'active',
          effectiveOn: null,
          expiresOn: null,
        },
        before: { current: null },
      },
    ],
  });
  await page.route('**/api/auth/csrf', (r) =>
    r.fulfill({ json: { token: 'csrf_11111111-1111-1111-1111-111111111111' } }),
  );
  await page.route('**/api/admin/targetsolutions/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/catalog'))
      return route.fulfill({
        json: {
          credentials: [
            { id: 10, name: 'Synthetic certification', displayName: 'Synthetic certification' },
          ],
          mappings: [],
        },
      });
    if (path.endsWith('/names')) return route.fulfill({ json: { names: [] } });
    if (path.endsWith('/review')) return route.fulfill({ json: { reviewed: 2 } });
    if (path.endsWith('/apply')) {
      applyCalls++;
      applied = true;
      return route.fulfill({ json: { processed: 1, eventsAdded: 1, remainingSafe: 0 } });
    }
    if (path.endsWith('/imports')) {
      if (route.request().method() === 'POST') {
        uploaded = true;
        return route.fulfill({ json: { id: 'synthetic-import' } });
      }
      return route.fulfill({
        json: {
          imports: uploaded
            ? [
                {
                  id: 'synthetic-import',
                  filename: 'synthetic.csv',
                  observed_on: '2026-09-07',
                  status: 'reviewed',
                },
              ]
            : [],
        },
      });
    }
    return route.fulfill({ json: detail() });
  });
  await page.goto('/admin/targetsolutions');
  await page.getByText('How to use this page', { exact: true }).click();
  await expect(page.getByText('Controls on this page:', { exact: true })).toBeVisible();
  await page.getByText('How to use this page', { exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'First Name,Last Name,Employee ID,Credential Name\nSynthetic,Member,synthetic-901,Synthetic certification',
    ),
  });
  await page.getByRole('button', { name: 'Upload and compare', exact: true }).click();
  await expect(page).toHaveURL(/import=synthetic-import/);
  await expect(page.getByText('2 distinct records', { exact: false })).toBeVisible();
  expect(applyCalls).toBe(0);
  await page
    .getByPlaceholder('Source reviewed and reason for the updates')
    .fill('Reviewed synthetic source; unresolved ID stays pending');
  await page.getByRole('button', { name: /Apply reviewed/ }).click();
  await expect.poll(() => applyCalls).toBe(1);
  await expect(page.getByText('Unmatched Employee IDs', { exact: false }).first()).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath('credential-review.png'), fullPage: true });
  expect(errors).toEqual([]);
});
