import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';
import {
  BID_COUNT,
  BID_HISTORY_COUNT,
  BID_YEAR,
  MISSING_CREDENTIAL_NAME,
  MISSING_MEMBER_ID,
  credentialName,
  installCurrentBidFixtures,
  memberId,
  positionId,
} from './current-bid-fixtures';

const impactArtifacts = path.resolve(
  process.env.CURRENT_BID_IMPACT_ARTIFACTS ??
    '../../tmp/unified-platform/current-bid-impact-browser-20260913',
);

// These tests operate the real Next/React UI against isolated synthetic data.
// Impact previews call the real service over migrated SQLite; legacy Save and
// Restore presentation fixtures check intent, while D1 writer tests prove commits.
type Fixture = Awaited<ReturnType<typeof installCurrentBidFixtures>>;
const workspace = (page: Page) => page.getByTestId('current-bid-workspace');
const editNavigation = (page: Page) =>
  workspace(page).getByRole('navigation', { name: 'Edit Bid sections', exact: true });
const sectionButton = (page: Page, name: string) =>
  editNavigation(page).getByRole('button', { name, exact: true });
const viewButton = (page: Page, name: string) =>
  workspace(page)
    .getByRole('navigation', { name: 'Bid workspace', exact: true })
    .getByRole('button', { name, exact: true });
const section = (page: Page, title: string) =>
  workspace(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const opportunityList = (page: Page) => section(page, 'Opportunities & positions');
const opportunityRows = (page: Page) => opportunityList(page).locator('button[aria-pressed]');
const historyRows = (page: Page) => workspace(page).getByRole('button', { name: /^Version \d+\b/ });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const impactSection = (page: Page, title: string) =>
  workspace(page).getByRole('heading', { name: title, exact: true }).locator('..').locator('..');
const impactDetails = (page: Page, title: string) =>
  workspace(page)
    .locator('summary')
    .filter({ hasText: new RegExp(`^${title}$`) })
    .locator('..');

async function openImpactDetails(page: Page, title: string) {
  const target = impactDetails(page, title);
  if ((await target.getAttribute('open')) === null) await enter(target.locator(':scope > summary'));
  return target;
}
async function selectTraceChoice(page: Page, label: string, query: string) {
  const group = workspace(page).getByRole('group', { name: label, exact: true });
  await group.getByRole('textbox').fill(query);
  const choice = group.getByRole('checkbox');
  await expect(choice).toHaveCount(1);
  await choice.focus();
  await expect(choice).toBeFocused();
  await choice.press('Space');
  await expect(choice).toBeChecked();
}
async function captureImpact(page: Page, file: string) {
  await mkdir(impactArtifacts, { recursive: true });
  await page.screenshot({ path: path.join(impactArtifacts, file), fullPage: true });
}
function assertImpactReadOnly(state: Fixture) {
  assertNoWrites(state);
  expect(state.impactReadOnlyProofs).toBe(state.impactRequests.length);
  for (const request of state.postRequests) {
    if (request.path === '/api/auth/csrf') continue;
    expect(request.path).toBe(`/api/admin/bid/${BID_YEAR}/preview`);
    expect(request.body?.kind).toBe('impact');
    expect(request.key).toBeNull();
  }
}

async function enter(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.press('Enter');
}

async function assertWidth(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    'The document must fit the actual viewport',
  ).toBeLessThanOrEqual(1);
  expect(
    await workspace(page).evaluate((node) => node.scrollWidth - node.clientWidth),
    'Current Bid must not create a horizontal scrolling workspace',
  ).toBeLessThanOrEqual(1);
}

async function assertControlLabels(page: Page) {
  const unnamed = await workspace(page)
    .locator('input:visible, textarea:visible, select:visible')
    .evaluateAll((controls) =>
      controls
        .filter((element) => {
          const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          return (
            !control.getAttribute('aria-label')?.trim() &&
            !control.getAttribute('aria-labelledby')?.trim() &&
            !Array.from(control.labels ?? []).some((label) => label.textContent?.trim())
          );
        })
        .map((control) => control.outerHTML),
    );
  expect(unnamed, 'Every visible edit control must have a programmatic label').toEqual([]);
}

function assertNoUnexpectedCalls(state: Fixture) {
  expect(state.unexpectedRequests).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

function assertNoWrites(state: Fixture) {
  expect(state.writeRequests, 'Browsing and cancelling must not submit a Bid save/restore').toEqual(
    [],
  );
  expect(state.mutations).toEqual({ save: 0, restore: 0 });
  assertNoUnexpectedCalls(state);
}

async function openBid(page: Page) {
  await page.goto(`/admin/current-bid?year=${BID_YEAR}`);
  await expect(workspace(page)).toBeVisible();
  await expect(workspace(page).getByRole('heading', { level: 1 })).toHaveText(
    `${BID_YEAR} Current Bid`,
  );
  await expect(
    workspace(page).getByLabel('Authoritative policy language', { exact: true }),
  ).toBeVisible();
}

async function chooseOpportunity(page: Page, id: string) {
  await enter(sectionButton(page, 'Opportunities & rules'));
  await workspace(page).getByLabel('Find an opportunity', { exact: true }).fill(id);
  await expect(opportunityRows(page)).toHaveCount(1);
  await enter(opportunityRows(page).first());
  await expect(workspace(page).getByLabel('Opportunity name', { exact: true })).toBeVisible();
}

async function useMainBidNavigation(page: Page) {
  const mobileToggle = page.getByRole('button', { name: 'Open admin navigation', exact: true });
  const mobile = await mobileToggle.isVisible();
  if (mobile) await enter(mobileToggle);
  const navigation = page.getByRole('navigation', { name: 'Admin navigation', exact: true });
  const bid = navigation.getByRole('link', { name: 'Bid', exact: true }).filter({ visible: true });
  await expect(bid).toHaveAttribute('href', `/admin/current-bid?year=${BID_YEAR}`);
  await enter(bid);
  if (mobile)
    await expect(page.getByRole('dialog', { name: 'Admin navigation', exact: true })).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/admin/current-bid\\?year=${BID_YEAR}$`));
  await expect(workspace(page).getByRole('heading', { level: 1 })).toHaveText(
    `${BID_YEAR} Current Bid`,
  );
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1857, height: 970 },
  { width: 646, height: 698 },
  { width: 390, height: 844 },
]) {
  test(`Current Bid sections and large catalogs remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const state = await installCurrentBidFixtures(page);
    await openBid(page);
    await useMainBidNavigation(page);
    await assertWidth(page);

    const policy = state.baseContent.settings;
    if (policy?.v !== 3) throw new Error('The synthetic Bid must have explicit operating policy');
    const stage = policy.livePolicy.stages[0];
    if (!stage) throw new Error('The synthetic Bid must have a stage');
    await enter(sectionButton(page, 'Participants & flow'));
    await workspace(page).locator('summary').filter({ hasText: stage.label }).first().click();
    const participants = workspace(page).getByRole('group', {
      name: `Participants in ${stage.label}`,
      exact: true,
    });
    await participants.getByRole('textbox').fill(String(MISSING_MEMBER_ID));
    await expect(participants.getByRole('checkbox')).toHaveCount(1);
    await expect(participants.getByRole('checkbox')).toBeChecked();
    await expect(participants).toContainText('Saved selection; catalog review required');
    await participants.getByRole('textbox').fill(String(memberId(BID_COUNT)));
    await expect(participants.getByRole('checkbox')).toHaveCount(1);
    await expect(participants).toContainText('Beyond Five Hundred');
    await assertControlLabels(page);
    await assertWidth(page);

    // Opportunity search must reach a real record after the first 500 entries.
    await chooseOpportunity(page, positionId(BID_COUNT));
    await expect(workspace(page).getByLabel('Opportunity name', { exact: true })).toHaveValue(
      state.baseContent.positions.find((row) => row.id === positionId(BID_COUNT))?.positionName ??
        '',
    );
    await chooseOpportunity(page, positionId(1));
    const qualifications = workspace(page).getByRole('group', {
      name: 'Required qualifications',
      exact: true,
    });
    await qualifications.getByRole('textbox').fill(MISSING_CREDENTIAL_NAME);
    await expect(qualifications.getByRole('checkbox')).toHaveCount(1);
    await expect(qualifications.getByRole('checkbox')).toBeChecked();
    await expect(qualifications).toContainText('Saved selection; catalog review required');
    await qualifications.getByRole('textbox').fill(credentialName(BID_COUNT));
    await expect(qualifications.getByRole('checkbox')).toHaveCount(1);
    await expect(qualifications).toContainText(credentialName(BID_COUNT));
    await assertControlLabels(page);
    await assertWidth(page);
    await workspace(page)
      .getByRole('heading', { name: 'Requirements', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`current-bid-rules-${viewport.width}.png`) });

    for (const [label, heading] of [
      ['Specialty rules', 'Specialty rules'],
      ['Contact & disposition', 'Contact procedure'],
      ['A-Day', 'A-Day'],
      ['Timing & evidence dates', 'Timing & evidence dates'],
      ['Authority & permissions', 'Authority & permissions'],
      ['Policy & language', 'Policy & language'],
    ] as const) {
      await enter(sectionButton(page, label));
      await expect(
        workspace(page).getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible();
      if (label === 'Specialty rules') {
        const specialty = policy.livePolicy.annualOperations?.specialties?.[0];
        if (!specialty) throw new Error('The synthetic Bid must include specialty rules');
        await workspace(page).locator('summary').filter({ hasText: specialty.label }).click();
      }
      if (label === 'Contact & disposition')
        await workspace(page)
          .locator('summary')
          .filter({ hasText: /^PASS$/ })
          .click();
      await assertControlLabels(page);
      await assertWidth(page);
    }

    for (const label of ['Bid Blueprint', 'Mock Bid', 'Live Bid', 'Results'] as const) {
      await enter(viewButton(page, label));
      await expect(
        workspace(page).getByRole('heading', {
          name: label === 'Live Bid' ? 'Managed Live preflight' : label,
          exact: true,
        }),
      ).toBeVisible();
      if (label === 'Bid Blueprint') {
        await expect(
          workspace(page).getByRole('region', { name: 'Bid relationship map', exact: true }),
        ).toBeVisible();
        const lenses = workspace(page).getByRole('tablist', { name: 'Bid Blueprint lenses' });
        const overview = lenses.getByRole('tab', { name: 'Overview', exact: true });
        const flow = lenses.getByRole('tab', { name: 'Flow', exact: true });
        const changes = lenses.getByRole('tab', { name: 'Changes', exact: true });
        await expect(overview).toHaveAttribute('aria-selected', 'true');
        await expect(overview).toHaveAttribute('tabindex', '0');
        await overview.focus();
        await overview.press('ArrowRight');
        await expect(flow).toBeFocused();
        await expect(flow).toHaveAttribute('aria-selected', 'true');
        await expect(flow).toHaveAttribute('tabindex', '0');
        await expect(overview).toHaveAttribute('tabindex', '-1');
        await flow.press('End');
        await expect(changes).toBeFocused();
        await expect(changes).toHaveAttribute('aria-selected', 'true');
        await changes.press('Home');
        await expect(overview).toBeFocused();
        await expect(overview).toHaveAttribute('aria-selected', 'true');
        await overview.press('ArrowLeft');
        await expect(changes).toBeFocused();
        await expect(changes).toHaveAttribute('aria-selected', 'true');
        await changes.press('Home');
        await expect(
          workspace(page).getByRole('tabpanel', { name: 'Overview', exact: true }),
        ).toBeVisible();
        await enter(lenses.getByRole('tab', { name: 'Specialty', exact: true }));
        await expect(lenses.getByRole('tab', { name: 'Specialty', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(
          workspace(page).getByText('Structured relationship list', { exact: true }),
        ).toBeVisible();
      }
      if (label === 'Live Bid') {
        await expect(
          workspace(page).getByRole('button', {
            name: 'Check Managed Live readiness',
            exact: true,
          }),
        ).toBeEnabled();
        await expect(workspace(page)).toContainText('No Live run is created by this check.');
        await expect(
          workspace(page).getByRole('link', { name: 'Open Live Bid console', exact: true }),
        ).toHaveCount(0);
      }
      await assertWidth(page);
    }
    await enter(viewButton(page, 'Edit Bid'));
    await workspace(page).getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`current-bid-workspace-${viewport.width}.png`) });
    expect(
      state.readRequests.some((request) => request.url.includes('/members?limit=500&offset=500')),
    ).toBe(true);
    expect(
      state.readRequests.some((request) =>
        request.url.includes('/credentials?limit=500&offset=500'),
      ),
    ).toBe(true);
    assertNoWrites(state);
  });
}

test('Opportunity and immutable version pagination expose every synthetic identity without writes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const state = await installCurrentBidFixtures(page);
  await openBid(page);
  await enter(sectionButton(page, 'Opportunities & rules'));
  const seen = new Set<string>();
  const expected = state.baseContent.positions.map((row) => row.id);
  for (let index = 0; index < Math.ceil(BID_COUNT / 20); index += 1) {
    const rows = opportunityRows(page);
    await expect(rows).toHaveCount(Math.min(20, BID_COUNT - index * 20));
    const text = await rows.allTextContents();
    const ids = expected.slice(index * 20, (index + 1) * 20);
    ids.forEach((id, ordinal) => {
      expect(text[ordinal]).toContain(id);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    });
    await assertWidth(page);
    const next = workspace(page).getByRole('button', { name: 'Next opportunities', exact: true });
    if (seen.size === BID_COUNT) await expect(next).toBeDisabled();
    else await enter(next);
  }
  expect([...seen]).toEqual(expected);
  await enter(workspace(page).getByRole('button', { name: 'Version history', exact: true }));
  await expect(historyRows(page)).toHaveCount(20);
  await enter(workspace(page).getByRole('button', { name: 'Load older versions', exact: true }));
  await expect(historyRows(page)).toHaveCount(BID_HISTORY_COUNT);
  await expect(
    workspace(page).getByRole('button', { name: 'Load older versions', exact: true }),
  ).toHaveCount(0);
  await enter(workspace(page).getByRole('button', { name: /^Version 1\b/ }));
  await expect(
    workspace(page).getByRole('heading', { name: 'Version 1', exact: true }),
  ).toBeVisible();
  expect(state.readRequests.some((request) => request.url.includes('beforeVersionNumber='))).toBe(
    true,
  );
  await assertWidth(page);
  assertNoWrites(state);
});

test('Keyboard Save records an edit directly without a required note or preview and preserves untouched rules', async ({
  page,
}) => {
  const state = await installCurrentBidFixtures(page);
  await openBid(page);
  const expected = structuredClone(state.current.expected);
  const content = structuredClone(state.baseContent);
  const notes = 'Synthetic keyboard-reviewed Bid notes\nRetain final rules and source provenance.';
  const reason = 'Updated Bid: notes.';
  const field = workspace(page).getByLabel('Bid notes', { exact: true });
  await field.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(notes);
  content.notes.bid = notes;
  await expect(workspace(page).getByLabel('Change summary', { exact: true })).toHaveValue('');
  expect(state.writeRequests).toEqual([]);
  await enter(workspace(page).getByRole('button', { name: 'Save Bid', exact: true }));
  await expect.poll(() => state.mutations.save).toBe(1);
  await expect(workspace(page).getByRole('status')).toContainText(
    `Version ${BID_HISTORY_COUNT + 1} saved`,
  );
  expect(state.writeRequests).toHaveLength(1);
  const request = state.writeRequests[0];
  expect(request?.path).toBe(`/api/admin/bid/${BID_YEAR}/versions`);
  expect(request?.key).toMatch(UUID);
  expect(request?.body).toEqual({ expected, content, reason });
  expect(state.current.content).toEqual(content);
  expect(state.current.content.rules).toEqual(state.baseContent.rules);
  expect(state.current.content.authoring).toEqual(state.baseContent.authoring);
  expect(state.current.content.staffingBindings).toEqual(state.baseContent.staffingBindings);
  expect(state.current.content.policy).toEqual(state.baseContent.policy);
  await expect(field).toHaveValue(notes);
  assertNoUnexpectedCalls(state);
});

test('Keyboard history allows inspection without a write and restores directly as a new version', async ({
  page,
}) => {
  const state = await installCurrentBidFixtures(page);
  await openBid(page);
  const expected = structuredClone(state.current.expected);
  await enter(workspace(page).getByRole('button', { name: 'Version history', exact: true }));
  await expect(historyRows(page)).toHaveCount(20);
  await enter(workspace(page).getByRole('button', { name: /^Version 7\b/ }));
  await expect(
    workspace(page).getByRole('heading', { name: 'Version 7', exact: true }),
  ).toBeVisible();
  await expect(
    workspace(page).getByRole('button', { name: 'Restore this version', exact: true }),
  ).toBeEnabled();
  await expect(workspace(page).getByLabel('Restore reason', { exact: true })).toHaveCount(0);
  assertNoWrites(state);
  await enter(viewButton(page, 'Edit Bid'));
  await expect(workspace(page).getByLabel('Bid notes', { exact: true })).toHaveValue(
    state.baseContent.notes.bid ?? '',
  );
  assertNoWrites(state);
  await enter(workspace(page).getByRole('button', { name: 'Version history', exact: true }));
  const reason = 'Restored Bid version 7.';
  await enter(workspace(page).getByRole('button', { name: 'Restore this version', exact: true }));
  await expect.poll(() => state.mutations.restore).toBe(1);
  await expect(workspace(page).getByRole('status')).toContainText(
    `Version ${BID_HISTORY_COUNT + 1} restored`,
  );
  expect(state.writeRequests).toHaveLength(1);
  const request = state.writeRequests[0];
  expect(request?.path).toBe(`/api/admin/bid/${BID_YEAR}/restore`);
  expect(request?.key).toMatch(UUID);
  expect(request?.body).toEqual({
    expected,
    versionId: state.history.find((item) => item.versionNumber === 7)?.id,
    reason,
  });
  expect(state.current.version?.versionNumber).toBe(BID_HISTORY_COUNT + 1);
  expect(state.current.version?.restoredFromId).toBe(
    (request?.body as { versionId: string }).versionId,
  );
  assertNoUnexpectedCalls(state);
});

test('Cancelling opportunity and rule removal plus rejected draft discard preserves the original Bid without writes', async ({
  page,
}) => {
  const state = await installCurrentBidFixtures(page);
  await openBid(page);
  await chooseOpportunity(page, positionId(1));
  await enter(workspace(page).getByRole('button', { name: 'Review rule removal', exact: true }));
  await expect(
    workspace(page).getByRole('button', { name: 'Confirm rule removal', exact: true }),
  ).toBeVisible();
  await enter(workspace(page).getByRole('button', { name: 'Keep Bid rule', exact: true }));
  await expect(
    workspace(page).getByRole('heading', { name: 'Requirements', exact: true }),
  ).toBeVisible();
  await workspace(page)
    .locator('summary')
    .filter({ hasText: /^Remove this opportunity$/ })
    .click();
  await enter(workspace(page).getByRole('button', { name: 'Review removal', exact: true }));
  await enter(workspace(page).getByRole('button', { name: 'Keep opportunity', exact: true }));
  await enter(workspace(page).getByRole('button', { name: 'Add opportunity', exact: true }));
  await workspace(page)
    .getByLabel('New opportunity identifier', { exact: true })
    .fill('synthetic-cancelled-opportunity');
  await enter(workspace(page).getByRole('button', { name: 'Cancel addition', exact: true }));
  await expect(workspace(page)).not.toContainText('Unsaved changes');
  await enter(sectionButton(page, 'Policy & language'));
  const notes = workspace(page).getByLabel('Bid notes', { exact: true });
  await notes.fill('Synthetic local note that must survive rejected discard');
  page.once('dialog', (dialog) => dialog.dismiss());
  await enter(workspace(page).getByRole('button', { name: 'Discard edits', exact: true }));
  await expect(notes).toHaveValue('Synthetic local note that must survive rejected discard');
  assertNoWrites(state);
  page.once('dialog', (dialog) => dialog.accept());
  await enter(workspace(page).getByRole('button', { name: 'Discard edits', exact: true }));
  await expect(notes).toHaveValue(state.baseContent.notes.bid ?? '');
  expect(state.current.content).toEqual(state.baseContent);
  assertNoWrites(state);
});

for (const viewport of [
  { width: 1857, height: 970 },
  { width: 1440, height: 900 },
  { width: 834, height: 1194 },
  { width: 390, height: 844 },
]) {
  test(`[bid-impact] Blueprint impact and authoritative three-channel trace fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const state = await installCurrentBidFixtures(page, { impact: true });
    try {
      await openBid(page);
      await enter(viewButton(page, 'Bid Blueprint'));
      await expect(
        workspace(page).getByRole('heading', { name: 'Bid Blueprint', exact: true }),
      ).toBeVisible();
      expect(state.impactRequests).toHaveLength(0);
      await enter(
        workspace(page).getByRole('button', { name: 'Evaluate draft impact', exact: true }),
      );
      const draft = impactSection(page, 'Unsaved draft');
      await expect(draft).toContainText(`${BID_COUNT} participants`);
      await expect(draft).toContainText('Operating policy references need review');
      await expect(draft).toContainText('specialty credential reference invalid');
      await expect(draft).not.toContainText('0 ranked candidates');
      await expect(workspace(page)).toContainText('The affected-person count excludes results');
      await assertControlLabels(page);
      await assertWidth(page);
      await captureImpact(page, `blueprint-${viewport.width}x${viewport.height}.png`);
      await draft
        .getByRole('heading', { name: 'Unsaved draft', exact: true })
        .evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await captureImpact(page, `blueprint-results-${viewport.width}x${viewport.height}.png`);

      await selectTraceChoice(page, 'Trace member', String(memberId(BID_COUNT)));
      await selectTraceChoice(page, 'Trace opportunity', positionId(1));
      await selectTraceChoice(page, 'Comparison member (optional)', String(memberId(1)));
      await enter(
        workspace(page).getByRole('button', { name: 'Show decision trace', exact: true }),
      );
      const decision = impactSection(page, 'Draft decision');
      await expect(decision).toContainText(
        '23 points · 11 Special Operations · 7 Marine Operations',
      );
      await expect(decision).toContainText('Meets the opportunity requirements');
      await expect(page.locator('h3:focus')).toContainText('Synthetic Beyond Five Hundred');
      await expect(page.locator('h3:focus')).toContainText(positionId(1));
      await expect(page.locator('h3:focus')).toBeInViewport();
      const awards = decision.locator('summary').filter({ hasText: /^Point awards$/ });
      await enter(awards);
      await expect(decision).toContainText('Total: 23');
      await expect(decision).toContainText('Special Operations: 11');
      await expect(decision).toContainText('Marine Operations: 7');
      await assertWidth(page);
      await assertControlLabels(page);
      await captureImpact(page, `trace-${viewport.width}x${viewport.height}.png`);
      await decision
        .getByRole('heading', { name: 'Draft decision', exact: true })
        .evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await captureImpact(page, `trace-card-${viewport.width}x${viewport.height}.png`);
      const traced = state.impactRequests.at(-1);
      expect(traced?.trace).toEqual({
        memberId: memberId(BID_COUNT),
        positionId: positionId(1),
        compareMemberId: memberId(1),
      });
      expect(traced?.expectedImpactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(traced?.expected).toEqual(state.current.expected);

      const requestsBeforeMode = state.impactRequests.length;
      await workspace(page)
        .getByLabel('Participation for this calculation', { exact: true })
        .selectOption('live');
      await expect(workspace(page)).toContainText('Evaluate it again for current results');
      await expect(
        workspace(page).getByRole('heading', { name: 'Draft decision', exact: true }),
      ).toHaveCount(0);
      expect(state.impactRequests).toHaveLength(requestsBeforeMode);
      await enter(
        workspace(page).getByRole('button', { name: 'Evaluate draft impact', exact: true }),
      );
      await expect(impactSection(page, 'Unsaved draft')).toContainText(`${BID_COUNT} participants`);
      expect(state.impactRequests.at(-1)?.mode).toBe('live');
      expect(state.impactRequests.at(-1)?.expectedImpactSha256).toBeUndefined();
      await assertWidth(page);
      assertImpactReadOnly(state);
    } finally {
      await state.dispose();
    }
  });
}

test('[bid-impact] Blueprint keyboard paging reaches all 521 opportunities and members with context-bound traces', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await installCurrentBidFixtures(page, { impact: true });
  try {
    await openBid(page);
    await chooseOpportunity(page, positionId(2));
    await workspace(page)
      .getByRole('group', { name: 'Point award 1', exact: true })
      .getByLabel('Points', { exact: true })
      .fill('18');
    await enter(viewButton(page, 'Bid Blueprint'));
    await enter(
      workspace(page).getByRole('button', { name: 'Evaluate draft impact', exact: true }),
    );
    await expect(workspace(page).getByTestId('bid-impact-change-summary')).toContainText(
      `${BID_COUNT} people with evaluated changes`,
    );

    const opportunityEvidence = await openImpactDetails(page, 'Eligibility by opportunity');
    const seenOpportunities = new Set<string>();
    for (let currentPage = 0; currentPage < Math.ceil(BID_COUNT / 20); currentPage++) {
      const ids = await opportunityEvidence.locator('li > strong').allTextContents();
      expect(ids).toEqual(
        state.baseContent.positions
          .slice(currentPage * 20, (currentPage + 1) * 20)
          .map((row) => row.id),
      );
      for (const id of ids) {
        expect(seenOpportunities.has(id)).toBe(false);
        seenOpportunities.add(id);
      }
      if (seenOpportunities.size < BID_COUNT)
        await enter(
          opportunityEvidence.getByRole('button', { name: 'Next opportunities', exact: true }),
        );
    }
    expect(seenOpportunities.size).toBe(BID_COUNT);
    expect(state.impactRequests).toHaveLength(1);

    const memberChoices = workspace(page).getByRole('group', { name: 'Trace member', exact: true });
    const seenMembers = new Set<string>();
    for (let currentPage = 0; currentPage < Math.ceil(BID_COUNT / 20); currentPage++) {
      const labels = await memberChoices
        .getByRole('checkbox')
        .evaluateAll((nodes) =>
          nodes.map((node) =>
            [...((node as HTMLInputElement).labels ?? [])]
              .map((label) => label.textContent?.trim())
              .join(' '),
          ),
        );
      const expectedNames = state.members
        .slice(currentPage * 20, (currentPage + 1) * 20)
        .map((row) => `${row.firstName} ${row.lastName} · ${row.rank}`);
      expect(labels).toEqual(expectedNames);
      for (const label of labels) {
        expect(seenMembers.has(label)).toBe(false);
        seenMembers.add(label);
      }
      if (seenMembers.size < BID_COUNT)
        await enter(memberChoices.getByRole('button', { name: 'Next choices', exact: true }));
    }
    expect(seenMembers.size).toBe(BID_COUNT);
    expect(state.impactRequests).toHaveLength(1);

    const changes = await openImpactDetails(page, 'Changed eligibility and priority');
    for (let offset = 0; offset < BID_COUNT; offset += 100) {
      await expect(
        changes.getByRole('button', { name: 'Inspect decision', exact: true }),
      ).toHaveCount(Math.min(100, BID_COUNT - offset));
      if (offset + 100 < BID_COUNT)
        await enter(changes.getByRole('button', { name: 'Next changes', exact: true }));
    }
    expect(
      state.impactRequests
        .filter((request) => request.changeOffset > 0)
        .map((request) => request.changeOffset),
    ).toEqual([100, 200, 300, 400, 500]);
    const impactHash = state.impactRequests.at(-1)?.expectedImpactSha256;
    await enter(changes.getByRole('button', { name: 'Inspect decision', exact: true }).last());
    await expect(impactSection(page, 'Draft decision')).toContainText('18 points');
    expect(state.impactRequests.at(-1)?.trace).toEqual({
      memberId: memberId(BID_COUNT),
      positionId: positionId(2),
    });
    expect(state.impactRequests.at(-1)?.expectedImpactSha256).toBe(impactHash);
    expect(state.impactRequests.at(-1)?.changeOffset).toBe(500);
    await expect(
      changes.getByRole('button', { name: 'Inspect decision', exact: true }),
    ).toHaveCount(21);
    await expect(
      impactSection(page, 'Draft decision').getByRole('heading', {
        name: 'Draft decision',
        exact: true,
      }),
    ).toBeInViewport();
    await expect(page.locator('h3:focus')).toContainText('Synthetic Beyond Five Hundred');
    await expect(page.locator('h3:focus')).toContainText(positionId(2));
    await expect(page.locator('h3:focus')).toBeInViewport();
    await captureImpact(page, 'keyboard-paging-trace-1440.png');

    // A local edit unmounts/replaces the old result. Returning to Blueprint must
    // not revive or silently recompute it; the operator explicitly evaluates.
    const beforeEdit = state.impactRequests.length;
    await enter(viewButton(page, 'Edit Bid'));
    await enter(sectionButton(page, 'Policy & language'));
    await workspace(page)
      .getByLabel('Bid notes', { exact: true })
      .fill('Synthetic new draft invalidates the old comparison');
    await enter(viewButton(page, 'Bid Blueprint'));
    await expect(workspace(page).getByTestId('bid-impact-change-summary')).toHaveCount(0);
    await expect(
      workspace(page).getByRole('heading', { name: 'Draft decision', exact: true }),
    ).toHaveCount(0);
    expect(state.impactRequests).toHaveLength(beforeEdit);
    await enter(
      workspace(page).getByRole('button', { name: 'Evaluate draft impact', exact: true }),
    );
    await expect(workspace(page).getByTestId('bid-impact-change-summary')).toContainText(
      `${BID_COUNT} people with evaluated changes`,
    );
    expect(state.impactRequests.at(-1)?.expectedImpactSha256).toBeUndefined();
    await assertWidth(page);
    assertImpactReadOnly(state);
  } finally {
    await state.dispose();
  }
});

test('[bid-impact] Blueprint unresolved draft source decisions remain blocked without invented zero results', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installCurrentBidFixtures(page, { impact: true });
  try {
    await openBid(page);
    const sources = section(page, 'Source decisions');
    await enter(sources.locator('summary').first());
    const resolved = sources.getByRole('checkbox', { name: 'Decision resolved', exact: true });
    await expect(resolved).toBeChecked();
    await resolved.focus();
    await resolved.press('Space');
    await expect(resolved).not.toBeChecked();
    await enter(viewButton(page, 'Bid Blueprint'));
    await enter(
      workspace(page).getByRole('button', { name: 'Evaluate draft impact', exact: true }),
    );
    await expect(impactSection(page, 'Current saved Bid')).toContainText(
      `${BID_COUNT} participants`,
    );
    const blocked = impactSection(page, 'Unsaved draft');
    await expect(blocked).toContainText('Resolve the open policy source decisions');
    await expect(blocked).not.toContainText('0 participants');
    await expect(workspace(page).getByTestId('bid-impact-change-summary')).toHaveCount(0);
    await expect(workspace(page)).toContainText('No missing result has been treated as zero');
    const eligibility = await openImpactDetails(page, 'Eligibility by opportunity');
    await expect(eligibility).toContainText('Not evaluated eligible members');
    await expect(eligibility).not.toContainText('→ 0 eligible members');
    await assertWidth(page);
    await assertControlLabels(page);
    await captureImpact(page, 'blocked-draft-phone-390.png');
    assertImpactReadOnly(state);
  } finally {
    await state.dispose();
  }
});
