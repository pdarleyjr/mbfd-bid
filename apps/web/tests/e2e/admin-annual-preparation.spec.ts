import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('annual seats retain conflicting edits and Mock creation retries the exact request', async ({
  page,
}, testInfo) => {
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('Local synthetic signing key required');
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
        emp: 'synthetic-annual-operator',
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
    .sign(/^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, 'hex') : new TextEncoder().encode(key));
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
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({
      json: { token: 'csrf_11111111-1111-1111-1111-111111111111' },
    }),
  );
  let revision = 0;
  let managed = false;
  const plan = () => ({
    year: 2027,
    effectiveOn: managed ? '2027-01-01' : null,
    ruleBookVersion: 'synthetic-2027',
    ruleBookRevision: revision,
    configurationRevision: revision,
    sourceRevision: revision,
    reviewRevision: 1,
    reviewedSourceRevision: null,
    reviewedRuleRevision: null,
    sourceSessionId: null,
    lifecycle: 'DRAFT',
    settings: {
      v: 1,
      credentialEvaluationOn: '2027-01-01',
      turnTimerSeconds: 90,
      expectedDurationDays: 3,
    },
  });
  let removed = false;
  const seat = {
    id: 'annual-seat-1',
    shift: 'A',
    station: 'Synthetic Station',
    unit: 'Synthetic Unit',
    rank: 'FF',
    name: 'Firefighter 1',
    participation: 'BIDDABLE',
    participationSource: 'inherited-unreviewed:synthetic',
    staffingPositionId: 'staffing-seat-1',
    bindingStatus: 'pending',
    isFloating: 0,
    isVacantByDesign: 0,
    isExcludedFromCount: 0,
  };
  await page.route('**/api/admin/annual-plan', (route) =>
    route.fulfill({
      json: { plans: [{ year: 2027, ruleBookStatus: 'DRAFT', effectiveOn: '2027-01-01' }] },
    }),
  );
  await page.route('**/api/admin/annual-plan/2027', (route) =>
    route.fulfill({ json: { plan: plan(), coverage: null } }),
  );
  await page.route('**/api/admin/annual-plan/official-sources', (route) =>
    route.fulfill({ json: { sources: [], notice: null } }),
  );
  const adoptions: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/annual-plan/2027/adopt', (route) => {
    adoptions.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON(),
    });
    managed = true;
    revision = 1;
    if (adoptions.length === 1) return route.abort('failed');
    return route.fulfill({ json: { year: 2027, replayed: true } });
  });
  await page.route('**/api/admin/current-roster?*', (route) =>
    route.fulfill({
      json: {
        positions: [
          { id: 'staffing-seat-1', stableSlotKey: 'Synthetic Station / A / Firefighter 1' },
        ],
      },
    }),
  );
  const seatWrites: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/annual-plan/2027/seats', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { seats: removed ? [] : [seat] } });
    seatWrites.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON(),
    });
    if (seatWrites.length === 1) {
      revision = 2;
      return route.fulfill({ status: 409, json: { error: 'annual_plan_revision_conflict' } });
    }
    revision = 3;
    seat.bindingStatus = 'approved';
    seat.participationSource = 'Synthetic approved seat review';
    return route.fulfill({ json: { ok: true } });
  });
  const removals: Record<string, unknown>[] = [];
  await page.route('**/api/admin/annual-plan/2027/seats/remove', (route) => {
    removals.push(route.request().postDataJSON());
    removed = true;
    revision = 4;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/admin/rehearsal/sessions', (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  const mocks: { key: string; body: Record<string, unknown> }[] = [];
  const checkpointWrites: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/annual-plan/2027/review*', (route) => {
    if (route.request().method() === 'POST') {
      checkpointWrites.push({
        key: route.request().headers()['idempotency-key'] ?? '',
        body: route.request().postDataJSON(),
      });
      if (checkpointWrites.length === 1) return route.abort('failed');
      return route.fulfill({ json: { checkpointId: 'synthetic-reviewed-source', replayed: true } });
    }
    const baseline = new URL(route.request().url()).searchParams.get('baseline') ?? 'official';
    const before = {
      eligible: true,
      points: 2,
      soPoints: 0,
      moPoints: 0,
      priority: 2,
      reasons: [],
    };
    const after = { ...before, points: 3, priority: 1 };
    return route.fulfill({
      json: {
        ready: false,
        ruleRevision: revision,
        configurationRevision: revision,
        sourceRevision: revision,
        sourceSessionId: 'synthetic-prior-completion',
        comparisonSource: baseline,
        checkpoint: { sourceRevision: 3, reviewedAt: 1000 },
        blockers: [{ code: 'synthetic_pending_review', detail: 'Synthetic review fixture only' }],
        changes: [],
        participants: { included: 105, excluded: 0 },
        impact: {
          scope: 'Synthetic policy comparison on fixed current evidence.',
          evidenceScope: 'Synthetic evidence comparison under fixed prior rules.',
          priorityScope: 'Priority does not predict awards.',
          available: true,
          evaluatedComparisons: 105,
          changed: Array.from({ length: 105 }, (_, index) => ({
            positionId: `synthetic-impact-seat-${index + 1}`,
            memberId: index + 1,
            before,
            after,
          })),
          evidence: {
            evaluatedComparisons: 104,
            changed: [
              {
                positionId: 'synthetic-evidence-seat',
                memberId: 2,
                before,
                after: {
                  ...after,
                  eligible: false,
                  priority: null,
                  reasons: ['Synthetic qualification expired'],
                },
              },
            ],
          },
          incomparable: {
            addedMemberIds: [105],
            removedMemberIds: [106],
            addedPositionIds: ['new-synthetic-seat'],
            removedPositionIds: [],
          },
        },
      },
    });
  });
  await page.route('**/api/admin/bid-session', (route) => {
    mocks.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON(),
    });
    if (mocks.length === 1) return route.abort('failed');
    return route.fulfill({ json: { id: 'synthetic-mock-exact-retry' } });
  });
  await page.goto('/admin/annual-plan?year=2027&stage=1');
  await expect(
    page.getByRole('heading', {
      name: 'Review existing draft for guided preparation',
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('main')
    .getByLabel('Personnel and staffing effective date', { exact: true })
    .fill('2027-01-01');
  await page
    .getByRole('main')
    .getByLabel('Credential evaluation date', { exact: true })
    .fill('2026-12-01');
  await page.getByRole('main').getByLabel('Turn timer (seconds)', { exact: true }).fill('90');
  await page.getByRole('main').getByLabel('Expected duration (days)', { exact: true }).fill('3');
  await page
    .getByRole('main')
    .getByLabel('Reason for adopting this draft', { exact: true })
    .fill('Synthetic reviewed adoption');
  await page
    .getByRole('checkbox', {
      name: 'I reviewed the existing designated draft and its annual preparation dates.',
      exact: true,
    })
    .check();
  await page
    .getByRole('button', { name: 'Adopt reviewed draft into annual preparation', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: /fetch|network/i })).toBeVisible();
  await expect(
    page.getByRole('main').getByLabel('Personnel and staffing effective date', { exact: true }),
  ).toHaveValue('2027-01-01');
  await page
    .getByRole('button', { name: 'Adopt reviewed draft into annual preparation', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Annual draft saved.' })).toBeVisible();
  expect(adoptions).toHaveLength(2);
  expect(adoptions[0]).toEqual(adoptions[1]);
  expect(adoptions[0]?.body).toMatchObject({
    expected_source_revision: 0,
    accept_existing_draft: true,
  });
  await page.getByRole('button', { name: /Stage 2 Organization and seats/ }).click();
  await page.getByRole('button', { name: 'Review seat', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Annual participation', exact: true })
    .selectOption('BIDDABLE');
  await page
    .getByRole('main')
    .getByLabel('Reviewed source reference', { exact: true })
    .fill('Synthetic approved seat review');
  await page
    .getByRole('main')
    .getByLabel('Reason', { exact: true })
    .fill('Synthetic annual participation review');
  await page.getByRole('button', { name: 'Save reviewed annual seat', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'annual plan revision conflict' }),
  ).toBeVisible();
  await expect(page.getByRole('main').getByLabel('Reason', { exact: true })).toHaveValue(
    'Synthetic annual participation review',
  );
  await page
    .getByRole('button', { name: 'Review latest plan without discarding edits', exact: true })
    .click();
  await expect(
    page.getByRole('main').getByText('Refreshed rule revision 2;', { exact: false }),
  ).toBeVisible();
  expect(seatWrites).toHaveLength(1);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`annual-seat-review-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page
    .getByRole('button', { name: 'Use reviewed revision and keep edits', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save reviewed annual seat', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Annual seat review saved.' }),
  ).toBeVisible();
  expect(seatWrites).toHaveLength(2);
  expect(seatWrites[0]?.body.expected_source_revision).toBe(1);
  expect(seatWrites[1]?.body.expected_source_revision).toBe(2);
  expect(seatWrites[0]?.key).not.toBe(seatWrites[1]?.key);
  expect(seatWrites[1]?.body.seats).toEqual([
    {
      existing_position_id: 'annual-seat-1',
      staffing_position_id: 'staffing-seat-1',
      bid_participation: 'BIDDABLE',
      is_floating: false,
      is_vacant_by_design: false,
      is_excluded_from_count: false,
    },
  ]);
  await page.getByRole('button', { name: 'Remove from annual draft', exact: true }).click();
  await page
    .getByRole('main')
    .getByLabel('Reviewed source reference', { exact: true })
    .fill('Synthetic authorized removal');
  await page
    .getByRole('main')
    .getByLabel('Reason', { exact: true })
    .fill('Synthetic duplicate annual seat removal');
  await page.getByRole('button', { name: 'Confirm reviewed removal', exact: true }).click();
  expect(removals).toHaveLength(0);
  await page
    .getByRole('checkbox', {
      name: 'I reviewed removal of this seat from the annual draft.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Confirm reviewed removal', exact: true }).click();
  await expect(
    page.getByRole('main').getByText('No seats included yet.', { exact: true }),
  ).toBeVisible();
  expect(removals[0]).toMatchObject({
    expected_source_revision: 3,
    confirm_remove: true,
    position_ids: ['annual-seat-1'],
  });
  await page.getByRole('button', { name: /Stage 6 Review and impact/ }).click();
  await expect(page.getByRole('main').getByText('Page 1 of 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'synthetic-impact-seat-105 · Member 105', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('main')
    .getByLabel('Filter by position or member ID', { exact: true })
    .fill('synthetic-impact-seat-105');
  await expect(page.getByRole('main').getByText('Page 1 of 1', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full review and impact', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Full review export missing');
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
  expect(exported.review.impact.changed).toHaveLength(105);
  expect(exported.review.sourceRevision).toBe(4);
  await page
    .getByRole('main')
    .getByLabel('Filter by position or member ID', { exact: true })
    .fill('');
  await page.getByRole('combobox', { name: 'Comparison', exact: true }).selectOption('evidence');
  await expect(
    page
      .getByRole('main')
      .getByText('Upcoming evidence: Ineligible: Synthetic qualification expired', {
        exact: true,
      }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Comparison baseline', exact: true })
    .selectOption('last_review');
  await page
    .getByRole('main')
    .getByText('What changed (0 position changes)', { exact: true })
    .click();
  await expect(
    page.getByRole('main').getByText('Compared with saved source revision 3.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('main')
    .getByLabel('Source review reason', { exact: true })
    .fill('Synthetic reviewed source');
  await page
    .getByRole('checkbox', {
      name: 'I reviewed the displayed source and configuration revisions.',
      exact: true,
    })
    .check();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`annual-source-review-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Save source review checkpoint', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /fetch|network/i })).toBeVisible();
  await expect(
    page.getByRole('main').getByLabel('Source review reason', { exact: true }),
  ).toHaveValue('Synthetic reviewed source');
  await page.getByRole('button', { name: 'Save source review checkpoint', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Source review saved.' })).toBeVisible();
  expect(checkpointWrites).toHaveLength(2);
  expect(checkpointWrites[0]).toEqual(checkpointWrites[1]);
  await page.getByRole('button', { name: /Stage 7 Practice and approve/ }).click();
  await page
    .getByRole('button', { name: 'Create Mock from reviewed configuration', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: /fetch|network/i })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Completed Mock rehearsal', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same Mock creation request', exact: true }).click();
  await expect(
    page.getByRole('main').getByText('Created Mock: synthetic-mock-exact-retry.', { exact: false }),
  ).toBeVisible();
  expect(mocks).toHaveLength(2);
  expect(mocks[0]).toEqual(mocks[1]);
  expect(mocks[0]?.key).not.toBe('');
  expect(mocks[0]?.body).toMatchObject({
    mode: 'mock',
    bid_year: 2027,
    expected_source_revision: 4,
  });
  await expect(
    page.getByRole('button', { name: 'Approve reviewed bid setup', exact: true }),
  ).toBeDisabled();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`annual-mock-retry-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
