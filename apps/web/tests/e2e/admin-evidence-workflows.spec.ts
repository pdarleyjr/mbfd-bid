import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('dated tenure and post-award review preserve edits and exact retries at three widths', async ({
  page,
}, testInfo) => {
  const signingKey = process.env.JWT_SIGNING_KEY;
  if (!signingKey) throw new Error('Local synthetic signing key required');
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const now = Math.floor(Date.now() / 1000);
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-evidence-operator',
        role: 'admin',
        security_version: 1,
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: now,
        authz_checked_at: now,
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
    .setProtectedHeader({ alg: 'HS256' })
    .sign(
      /^[0-9a-f]{64}$/i.test(signingKey)
        ? Buffer.from(signingKey, 'hex')
        : new TextEncoder().encode(signingKey),
    );
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
      value: token,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ json: { token: 'csrf_11111111-1111-1111-1111-111111111111' } }),
  );
  await page.route('**/api/admin/members?**', (route) =>
    route.fulfill({
      json: {
        members: [{ id: 101, employeeId: 'SYN-101', firstName: 'Synthetic', lastName: 'Member' }],
        total: 1,
      },
    }),
  );
  await page.route('**/api/admin/current-roster?**', (route) =>
    route.fulfill({
      json: { positions: [{ id: 'seat-1', stableSlotKey: 'Synthetic Training / Instructor' }] },
    }),
  );
  const tenureRecords: Record<string, unknown>[] = [];
  const tenureRequests: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/tenure-evidence/history/*', (route) =>
    route.fulfill({ json: { records: tenureRecords } }),
  );
  await page.route('**/api/admin/tenure-evidence', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    tenureRequests.push({ key: route.request().headers()['idempotency-key'] ?? '', body });
    if (tenureRequests.length === 1)
      return route.fulfill({ status: 409, json: { error: 'synthetic_transaction_rolled_back' } });
    if (tenureRequests.length === 3) {
      tenureRecords.push({
        ...tenureRecords[0],
        id: 'other-reviewed-source',
        revision: 2,
        reason: 'Synthetic concurrent review',
      });
      return route.fulfill({ status: 409, json: { error: 'tenure_revision_conflict' } });
    }
    tenureRecords.push({
      id: `review-${tenureRecords.length + 1}`,
      revision: tenureRecords.length + 1,
      effectiveOn: body.effective_on,
      status: body.status,
      memberId: body.member_id,
      protectedFrom: body.protected_from,
      protectedThrough: body.protected_through,
      sourceRef: body.source_ref,
      reason: body.reason,
      actorSubject: '901',
    });
    return route.fulfill({ status: 201, json: { id: 'review-1', revision: 1, replayed: false } });
  });
  const membersLoaded = page.waitForResponse(
    (r) => r.url().includes('/api/admin/members?') && r.status() === 200,
  );
  await page.goto('/admin/personnel/tenure');
  await membersLoaded;
  await page.getByLabel('Staffing date', { exact: true }).fill('2027-01-01');
  await expect(
    page.getByRole('combobox', { name: 'Authorized staffing seat', exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  await page
    .getByRole('combobox', { name: 'Authorized staffing seat', exact: true })
    .selectOption('seat-1');
  await page.getByLabel('Evidence effective date', { exact: true }).fill('2026-09-06');
  await page
    .getByRole('combobox', { name: 'Reviewed status', exact: true })
    .selectOption('PROTECTED');
  await page.getByRole('combobox', { name: 'Protected member', exact: true }).selectOption('101');
  await page.getByLabel('Protected from', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Protected through (inclusive)', { exact: true }).fill('2028-12-31');
  await page
    .getByLabel('Authoritative source reference', { exact: true })
    .fill('Synthetic reviewed tenure source');
  await page.getByLabel('Review reason', { exact: true }).fill('Synthetic term evidence review');
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath(`tenure-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Record reviewed tenure', exact: true }).click();
  await expect(page.getByText('synthetic transaction rolled back', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Protected through (inclusive)', { exact: true })).toHaveValue(
    '2028-12-31',
  );
  await page.getByRole('button', { name: 'Record reviewed tenure', exact: true }).click();
  await expect(page.getByText(/Revision 1 · 2026-09-06 · PROTECTED/)).toBeVisible();
  expect(tenureRequests).toHaveLength(2);
  expect(tenureRequests[0]).toEqual(tenureRequests[1]);
  expect(tenureRequests[0]?.key).not.toBe('');
  await page.getByLabel('Evidence effective date', { exact: true }).fill('2027-01-01');
  await page
    .getByRole('combobox', { name: 'Reviewed status', exact: true })
    .selectOption('UNKNOWN');
  await page
    .getByLabel('Authoritative source reference', { exact: true })
    .fill('Synthetic follow-up evidence');
  await page.getByLabel('Review reason', { exact: true }).fill('Synthetic retained review reason');
  await page.getByRole('button', { name: 'Record reviewed tenure', exact: true }).click();
  await expect(page.getByText('tenure revision conflict', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh history and retain edits', exact: true }).click();
  await expect(page.getByText('Tenure revision 2.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Review reason', { exact: true })).toHaveValue(
    'Synthetic retained review reason',
  );
  expect(tenureRequests).toHaveLength(3);
  await page.getByRole('button', { name: 'Use reviewed evidence revision', exact: true }).click();
  await page.getByRole('button', { name: 'Record reviewed tenure', exact: true }).click();
  await expect(page.getByText(/Revision 3 · 2027-01-01 · UNKNOWN/)).toBeVisible();
  expect(tenureRequests[2]?.body.expected_revision).toBe(1);
  expect(tenureRequests[3]?.body.expected_revision).toBe(2);
  expect(tenureRequests[2]?.key).not.toBe(tenureRequests[3]?.key);
  const serviceRequests: { key: string; body: Record<string, unknown> }[] = [];
  let serviceRevision = 0;
  await page.route('**/api/admin/service-evidence/types', (route) =>
    route.fulfill({
      json: { types: [{ id: 'SYNTHETIC_SERVICE', name: 'Synthetic reviewed service' }] },
    }),
  );
  await page.route('**/api/admin/service-evidence?**', (route) =>
    route.fulfill({
      json: {
        records: serviceRevision
          ? [
              {
                id: 'synthetic-service-record',
                memberId: 101,
                serviceCode: 'SYNTHETIC_SERVICE',
                revision: serviceRevision,
                effectiveOn: '2026-01-01',
                verifiedMonths: 10,
                sourceRef: 'Synthetic source',
                reason: 'Synthetic review',
                actorSubject: '901',
              },
            ]
          : [],
      },
    }),
  );
  await page.route('**/api/admin/service-evidence', (route) => {
    serviceRequests.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON(),
    });
    serviceRevision++;
    return serviceRequests.length === 1
      ? route.fulfill({ status: 409, json: { error: 'service_revision_conflict' } })
      : route.fulfill({ json: { revision: serviceRevision } });
  });
  await page.goto('/admin/personnel/service-evidence');
  await page.getByRole('combobox', { name: 'Member', exact: true }).selectOption('101');
  await page
    .getByRole('combobox', { name: 'Service category', exact: true })
    .selectOption('SYNTHETIC_SERVICE');
  await page.getByLabel('Effective date of this evidence', { exact: true }).fill('2027-01-01');
  await page.getByLabel('Verified cumulative completed months', { exact: true }).fill('36');
  await page
    .getByLabel('Authoritative source reference', { exact: true })
    .fill('Synthetic service source');
  await page.getByLabel('Review reason', { exact: true }).fill('Synthetic service reconciliation');
  await page.getByRole('button', { name: 'Record reviewed service evidence', exact: true }).click();
  await expect(page.getByText('service revision conflict', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh history and retain edits', exact: true }).click();
  await expect(page.getByText('Service revision 1.', { exact: false })).toBeVisible();
  expect(serviceRequests).toHaveLength(1);
  await page.getByRole('button', { name: 'Use reviewed evidence revision', exact: true }).click();
  await expect(
    page.getByLabel('Verified cumulative completed months', { exact: true }),
  ).toHaveValue('36');
  await page.getByRole('button', { name: 'Record reviewed service evidence', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Dated service evidence recorded.' }),
  ).toBeVisible();
  expect(serviceRequests[0]?.body.expected_revision).toBe(0);
  expect(serviceRequests[1]?.body.expected_revision).toBe(1);
  expect(serviceRequests[0]?.key).not.toBe(serviceRequests[1]?.key);
  const term = {
    id: 'training',
    credential: 'Synthetic Training',
    sourceRef: 'Synthetic approved annual term',
    deadline: {
      basis: 'APPROVED_BID_START_DATE',
      startOn: '2027-01-01',
      unit: 'CALENDAR_MONTHS',
      count: 3,
      timeZone: 'America/New_York',
    },
  };
  const reviews: Record<string, unknown>[] = [];
  const obligationRequests: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/annual-plan/official-sources', (route) =>
    route.fulfill({ json: { sources: [{ sessionId: 'synthetic-completed', year: 2027 }] } }),
  );
  await page.route('**/api/admin/post-award-obligations/synthetic-completed?**', (route) =>
    route.fulfill({
      json: {
        completion: { revision: 12 },
        obligations: [
          {
            term,
            positionId: 'A-1',
            memberId: 101,
            memberName: 'Synthetic Member',
            finalBidId: 'final-award',
            dueOn: '2027-04-01',
            status: reviews.length ? 'COMPLETED' : 'OVERDUE',
            completionTiming: reviews.length ? 'AFTER_DEADLINE' : null,
            latestRevision: reviews.length,
            award: { eventId: 'award-event', awardedAtMs: Date.parse('2027-01-31T18:00:00Z') },
            history: reviews,
          },
        ],
      },
    }),
  );
  await page.route('**/api/admin/post-award-obligations/synthetic-completed/reviews', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    obligationRequests.push({ key: route.request().headers()['idempotency-key'] ?? '', body });
    if (!reviews.length)
      reviews.push({
        id: 'obligation-review',
        revision: 1,
        effectiveOn: body.effective_on,
        status: body.status,
        completedOn: body.completed_on,
        sourceRef: body.source_ref,
        reason: body.reason,
        actorSubject: '901',
      });
    if (obligationRequests.length === 1) return route.abort('failed');
    return route.fulfill({ json: { id: 'obligation-review', revision: 1, replayed: true } });
  });
  await page.goto('/admin/personnel/obligations');
  await page
    .getByRole('combobox', { name: 'Official completed bid', exact: true })
    .selectOption('synthetic-completed');
  await page.getByLabel('Review as of', { exact: true }).fill('2027-04-20');
  await page.getByRole('button', { name: 'Review evidence', exact: true }).click();
  await expect(
    page.getByText(
      'Measured from approved bid start 2027-01-01; retained through award amendments.',
    ),
  ).toBeVisible();
  await page.getByLabel('Review effective date', { exact: true }).fill('2027-04-20');
  await page
    .getByRole('combobox', { name: 'Reviewed status', exact: true })
    .selectOption('COMPLETED');
  await page.getByLabel('Verified completion date', { exact: true }).fill('2027-04-19');
  await page
    .getByLabel('Evidence reference', { exact: true })
    .fill('Synthetic verified completion source');
  await page.getByLabel('Review reason', { exact: true }).fill('Synthetic completion review');
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath(`obligation-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Record review', exact: true }).click();
  await expect(page.getByLabel('Verified completion date', { exact: true })).toHaveValue(
    '2027-04-19',
  );
  await expect(page.getByRole('status').filter({ hasText: /fetch|network/i })).toBeVisible();
  await page.getByRole('button', { name: 'Record review', exact: true }).click();
  await expect(page.getByText('COMPLETED · AFTER DEADLINE', { exact: true })).toBeVisible();
  expect(obligationRequests).toHaveLength(2);
  expect(obligationRequests[0]).toEqual(obligationRequests[1]);
  expect(errors).toEqual([]);
});
