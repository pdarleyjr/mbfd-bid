import { BidDefinitionContentSchema } from '@mbfd/shared';
import { expect, test } from '@playwright/test';
import { BID_YEAR, installCurrentBidFixtures, memberId } from './current-bid-fixtures';

// Real routed UI, synthetic presentation/API fixtures only. These tests prove
// review intent and request boundaries, not Department persistence or live readiness.
test('pending source procedures remain visible and cannot be promoted with unresolved authority', async ({
  page,
}) => {
  const state = await installCurrentBidFixtures(page);
  const content = state.current.content;
  const source = content.policy;
  if (!source?.executionPolicy.annualOperations) throw new Error('Synthetic policy required');
  const policy = source.executionPolicy;
  const annual = source.executionPolicy.annualOperations;
  const language = 'SYNTHETIC reviewed source clause: select the assignment and A-Day together.';
  state.current.content = BidDefinitionContentSchema.parse({
    ...content,
    settings: null,
    policy: null,
    pendingPolicy: {
      policyText: language,
      executionPolicy: {
        ...policy,
        stages: policy.stages.map((stage) => ({ ...stage, memberIds: [] })),
        actionPermissions: policy.actionPermissions.map((grant) => ({
          ...grant,
          actorMemberIds: [],
        })),
        annualOperations: {
          ...annual,
          contact: {
            minimumAttempts: null,
            timingMode: 'OPERATOR_DISCRETION',
            durationSeconds: null,
          },
          aDay: { ...annual.aDay, min: null, max: null, captainDcMax: null },
        },
      },
    },
  });
  await page.goto(`/admin/current-bid?year=${BID_YEAR}`);
  const workspace = page.getByTestId('current-bid-workspace');
  await expect(
    workspace.getByRole('heading', { name: 'Source policy awaiting operational decisions' }),
  ).toBeVisible();
  await expect(workspace.getByLabel('Pending authoritative policy language')).toHaveValue(language);
  await expect(
    workspace.getByText('This saved policy is not executable.', { exact: false }),
  ).toBeVisible();
  const promote = workspace.getByRole('button', { name: 'Use reviewed procedures in this draft' });
  await expect(promote).toBeDisabled();
  await workspace
    .locator('summary')
    .filter({ hasText: /^Contact and A-Day decisions$/ })
    .click();
  await expect(workspace.getByLabel('Required contact attempts')).toHaveValue('');
  await workspace.getByLabel('Required contact attempts').fill('3');
  await workspace.getByLabel('General minimum per A-Day group').fill('1');
  await workspace.getByLabel('General maximum per A-Day group').fill('8');
  await workspace.getByLabel('Captain / DC maximum per group').fill('2');
  // Numeric review alone supplies neither participants, operators nor dates.
  await expect(promote).toBeDisabled();
  await workspace
    .locator('summary')
    .filter({ hasText: /^Real Bid action authority$/ })
    .click();
  const authority = workspace.locator('details').filter({
    has: page.locator('summary').filter({ hasText: /^Real Bid action authority$/ }),
  });
  await expect(authority.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await workspace
    .getByLabel('Pending authoritative policy language')
    .fill(`${language}\nSynthetic review note.`);
  await expect(promote).toBeDisabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(state.writeRequests).toEqual([]);
  expect(state.postRequests.filter((request) => request.path !== '/api/auth/csrf')).toEqual([]);
  expect(state.pageErrors).toEqual([]);
  expect(state.unexpectedRequests).toEqual([]);
});

test('ordinal upload requires valid source review and explicit save', async ({ page }) => {
  const state = await installCurrentBidFixtures(page);
  const writes: { body: unknown; key: string | undefined }[] = [];
  await page.route('**/api/admin/bid-ordinals/*', (route) =>
    route.fulfill({ json: { dataset: null } }),
  );
  await page.route('**/api/admin/bid-ordinals', (route) => {
    writes.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    return route.fulfill({ json: { revision: 1 } });
  });
  await page.goto('/admin/personnel/bid-evidence');
  await page.getByLabel('Bid year', { exact: true }).fill(String(BID_YEAR));
  const upload = page.getByLabel('Reviewed ordinal mapping');
  const candidate = {
    bidYear: BID_YEAR,
    expectedRevision: 0,
    sourceSha256: 'a'.repeat(64),
    sourceRef: 'SYNTHETIC reviewed annual ranking source',
    reason: 'Synthetic exact identity and source review',
    entries: [
      {
        memberId: memberId(1),
        employeeId: 'SYNTHETIC-BID-0001',
        timeInGrade: 2,
        departmentService: 4,
      },
    ],
  };
  const file = (body: unknown) => ({
    name: 'synthetic-reviewed-ordinals.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(body)),
  });
  await upload.setInputFiles(file({ ...candidate, sourceRef: '' }));
  await expect(
    page.getByText(
      'Mapping requires unique identities and positive integer ordinals with complete source evidence.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save reviewed Bid ordinals' })).toHaveCount(0);
  await upload.setInputFiles(file({ ...candidate, expectedRevision: 1 }));
  await expect(page.getByRole('button', { name: 'Save reviewed Bid ordinals' })).toBeDisabled();
  await upload.setInputFiles(file(candidate));
  await expect(page.getByText(candidate.sourceRef, { exact: false })).toBeVisible();
  await expect(page.getByText(candidate.sourceSha256, { exact: false })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save reviewed Bid ordinals' });
  await expect(save).toBeEnabled();
  expect(writes).toEqual([]);
  await save.click();
  await expect(
    page.getByText(
      'Reviewed evidence saved. Existing personnel dates and Bid history are retained.',
    ),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toEqual(candidate);
  expect(writes[0]?.key).toMatch(/^[a-f0-9-]{36}$/i);
  expect(state.writeRequests).toEqual([]);
  expect(state.unexpectedRequests).toEqual([]);
  expect(state.pageErrors).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('Days tour evidence preserves unknown, no and yes as distinct reviewed findings', async ({
  page,
}) => {
  const state = await installCurrentBidFixtures(page);
  const writes: { body: Record<string, unknown>; key: string | undefined }[] = [];
  await page.route('**/api/admin/bid-ordinals/*', (route) =>
    route.fulfill({ json: { dataset: null } }),
  );
  await page.route('**/api/admin/bid-tour-evidence/*', (route) =>
    route.fulfill({ json: { records: [] } }),
  );
  await page.route('**/api/admin/bid-tour-evidence', (route) => {
    writes.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    return route.fulfill({ json: { revision: 1 } });
  });
  await page.goto('/admin/personnel/bid-evidence');
  const historyLoaded = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/bid-tour-evidence/${memberId(1)}`),
  );
  await page
    .getByRole('combobox', { name: 'Member', exact: true })
    .selectOption(String(memberId(1)));
  await historyLoaded;
  const finding = page.getByRole('combobox', { name: 'Reviewed finding', exact: true });
  const save = page.getByRole('button', { name: 'Save reviewed tour evidence' });
  await expect(finding).toHaveValue('unknown');
  await expect(save).toBeDisabled();
  expect(writes).toEqual([]);
  for (const [choice, expected] of [
    ['unknown', null],
    ['no', false],
    ['yes', true],
  ] as const) {
    await page.getByLabel('Effective date', { exact: true }).fill('2027-01-01');
    await page
      .getByLabel('Source reference', { exact: true })
      .fill('SYNTHETIC completed tour review');
    await page.getByLabel('Reason', { exact: true }).fill('Synthetic source finding');
    await finding.selectOption(choice);
    await save.click();
    await expect(
      page.getByText(
        'Reviewed evidence saved. Existing personnel dates and Bid history are retained.',
      ),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(finding).toHaveValue('unknown');
    expect(writes.at(-1)?.body).toEqual({
      memberId: memberId(1),
      expectedRevision: 0,
      effectiveOn: '2027-01-01',
      completedDaysTour: expected,
      sourceRef: 'SYNTHETIC completed tour review',
      reason: 'Synthetic source finding',
    });
  }
  expect(writes).toHaveLength(3);
  expect(new Set(writes.map((write) => write.key)).size).toBe(3);
  await page
    .getByRole('combobox', { name: 'Member', exact: true })
    .selectOption(String(memberId(2)));
  await expect(finding).toHaveValue('unknown');
  await expect(page.getByLabel('Source reference', { exact: true })).toHaveValue('');
  await expect(save).toBeDisabled();
  expect(state.writeRequests).toEqual([]);
  expect(state.unexpectedRequests).toEqual([]);
  expect(state.pageErrors).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});
