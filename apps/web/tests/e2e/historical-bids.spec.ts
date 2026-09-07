import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('historical awards, current Days supplement and reviewed upload remain separate', async ({
  page,
}) => {
  const key = process.env.JWT_SIGNING_KEY;
  expect(key, 'Explicit synthetic local signing key required').toBeTruthy();
  const now = Math.floor(Date.now() / 1000);
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-admin',
        role: 'admin',
        security_version: 1,
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: now,
        authz_checked_at: now,
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
    .setProtectedHeader({ alg: 'HS256' })
    .sign(
      /^[a-f0-9]{64}$/i.test(key ?? '')
        ? Buffer.from(key ?? '', 'hex')
        : new TextEncoder().encode(key),
    );
  await page.context().addCookies([
    { name: 'mbfd_bid_jwt', value: token, url: 'http://localhost:3000' },
    { name: 'mbfd_pin', value: 'ok', url: 'http://localhost:3000' },
  ]);
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const archive = {
    schemaVersion: 1,
    year: 2025,
    label: 'Synthetic historical award document',
    notes: ['Station 6 was not in service in 2025.'],
    sources: [{ id: 'synthetic-image', name: 'synthetic.png', sha256: 'a'.repeat(64) }],
    seats: [
      {
        id: 'A601',
        shift: 'A',
        station: 'Rescue Float Pool',
        unit: 'Rescue Float Pool',
        position: 'Lieutenant (R)',
        name: 'Historical Image Winner',
        group: 'GR2',
        status: 'AWARDED',
        sourceId: 'synthetic-image',
        sourceLocation: 'Row A601',
        note: null,
      },
      {
        id: 'D101',
        shift: 'D',
        station: 'Prevention',
        unit: 'Public Education',
        position: 'Lieutenant',
        name: 'Historical Days Winner',
        group: 'FRI',
        status: 'AWARDED',
        sourceId: 'synthetic-image',
        sourceLocation: 'Row D101',
        note: null,
      },
    ],
  };
  let writes = 0;
  let lastUpload: unknown;
  let selectedArchive = archive;
  let selectedHash = 'b'.repeat(64);
  const csrfToken = 'csrf_11111111-1111-1111-1111-111111111111';
  await page.route('**/api/auth/csrf', (route) => route.fulfill({ json: { token: csrfToken } }));
  await page.route('**/api/admin/historical-bids', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-mbfd-csrf']).toBe(csrfToken);
      writes++;
      lastUpload = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { sha256: 'b'.repeat(64) } });
    } else await route.fulfill({ json: { years: [2025] } });
  });
  await page.route('**/api/admin/historical-bids/2025', (route) =>
    route.fulfill({
      json: {
        archive: selectedArchive,
        sha256: selectedHash,
        publishedAt: '2026-09-07T12:00:00.000Z',
        publishedBy: '901',
      },
    }),
  );
  await page.route('**/api/admin/historical-bids/2024', (route) =>
    route.fulfill({ status: 404, json: { error: 'historical_bid_not_found' } }),
  );
  await page.route('**/api/admin/historical-bids/2025/amendments', (route) => {
    expect(route.request().headers()['x-mbfd-csrf']).toBe(csrfToken);
    writes++;
    lastUpload = route.request().postDataJSON();
    selectedArchive = (lastUpload as { archive: typeof archive }).archive;
    selectedHash = 'c'.repeat(64);
    return route.fulfill({ status: 201, json: { sha256: selectedHash } });
  });
  await page.route('**/api/admin/historical-bids/2025/days-supplement', (route) =>
    route.fulfill({
      json: {
        asOf: '2026-09-07',
        excludedPositions: 2,
        positions: [
          {
            id: 'current-official',
            station: 'Chief Office',
            unit: 'Administration',
            position: 'Analyst',
            name: 'Current Official Occupant',
            occupancy: 'occupied',
          },
        ],
      },
    }),
  );
  await page.route('**/api/admin/annual-plan/official-sources', (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.route('**/api/admin/annual-plan', (route) =>
    route.fulfill({ json: { plans: [{ year: 2026, ruleBookVersion: '2026.1' }] } }),
  );
  await page.route('**/api/admin/bid-board?**', (route) => {
    const view = new URL(route.request().url()).searchParams.get('view');
    return route.fulfill({
      json: {
        view,
        lifecycle: view === 'upcoming' ? 'FROZEN' : 'CURRENT',
        generatedAt: new Date().toISOString(),
        notice: null,
        source: {
          label: 'Synthetic protected configuration',
          year: 2026,
          asOf: null,
          sessionId: null,
          templateVersion: '2026.1',
          ruleBookVersion: '2026.1',
          configurationRevision: 17,
          ruleBookRevision: 9,
          completionRevision: null,
        },
        seats: [
          {
            id: 'protected-2026',
            shift: 'A',
            station: '6',
            unit: 'Rescue 6',
            position: '2026 prepared seat',
            rank: 'LT',
            participation: 'BIDDABLE',
            mapping: 'mapped',
          },
        ],
      },
    });
  });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin/bid-board?view=previous&shift=A');
    await expect(page.getByText('Historical Image Winner', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Rescue Float Pool', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Station 6', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.getByRole('combobox', { name: 'Shift', exact: true }).selectOption('D');
  await expect(page.getByText('Historical Days Winner', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Current official Days positions · supplement' }),
  ).toBeVisible();
  await expect(page.getByText('Current Official Occupant', { exact: true })).toBeVisible();
  await page.getByText('Import historical bid results', { exact: true }).click();
  await page.getByLabel('Historical archive JSON').setInputFiles({
    name: 'synthetic-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...archive, year: 2024 })),
  });
  await expect(
    page.getByRole('button', { name: 'Publish reviewed 2024 historical bid' }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Publish reviewed 2024 historical bid' }).click();
  await expect(page.getByText(/2024 historical bid published/)).toBeVisible();
  expect(writes).toBe(1);
  expect(lastUpload).toEqual({ ...archive, year: 2024 });
  const amendment = { ...archive, notes: [...archive.notes, 'Synthetic source correction'] };
  await page.getByLabel('Historical archive JSON').setInputFiles({
    name: 'synthetic-amendment.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(amendment)),
  });
  await expect(
    page.getByRole('button', { name: 'Publish reviewed 2025 amendment' }),
  ).toBeDisabled();
  await page.getByLabel('Amendment reason').fill('Reviewed synthetic correction');
  await page.getByRole('button', { name: 'Publish reviewed 2025 amendment' }).click();
  await expect(page.getByText(/2025 historical bid published/)).toBeVisible();
  expect(lastUpload).toEqual({
    archive: amendment,
    expectedSha256: 'b'.repeat(64),
    reason: 'Reviewed synthetic correction',
  });
  await page.goto('/admin/bid-board?view=upcoming&year=2026&shift=A');
  await expect(page.getByText('2026 prepared seat', { exact: true })).toBeVisible();
  await expect(page.getByText('Historical Image Winner', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Current Official Occupant', { exact: true })).toHaveCount(0);
  expect(writes).toBe(2);
  expect(errors).toEqual([]);
});
