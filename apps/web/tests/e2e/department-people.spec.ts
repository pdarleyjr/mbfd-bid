import { writeFile } from 'node:fs/promises';
import { type Locator, type Page, expect, test } from '@playwright/test';
import {
  AFTER_EVENT_DATE,
  LONG_FIRST,
  LONG_LAST,
  PEOPLE_COUNT,
  PEOPLE_DATE,
  employeeId,
  installPeopleFixture,
  memberId,
  peopleSnapshot,
} from './department-people-fixtures';

// Accessible contracts for the integrated Department workspace and existing forms.
const UI = {
  workspace: (page: Page) => page.getByTestId('department-people'),
  rows: (page: Page) => UI.workspace(page).locator('[data-member-id]:visible'),
  search: (page: Page) =>
    UI.workspace(page).getByRole('searchbox', { name: 'Search people', exact: true }),
  submitSearch: (page: Page) =>
    UI.workspace(page).getByRole('button', { name: 'Search', exact: true }),
  date: (page: Page) => UI.workspace(page).getByLabel('As of date', { exact: true }),
  status: (page: Page) =>
    UI.workspace(page).getByRole('combobox', { name: 'Employment status', exact: true }),
  previous: (page: Page) =>
    UI.workspace(page).getByRole('button', { name: 'Previous people page', exact: true }),
  next: (page: Page) =>
    UI.workspace(page).getByRole('button', { name: 'Next people page', exact: true }),
  view: (page: Page, id: number) =>
    UI.workspace(page)
      .locator(`[data-member-id="${id}"]:visible`)
      .getByRole('button', { name: /^View member / }),
  memberPanel: (page: Page) => page.getByRole('region', { name: 'Member details', exact: true }),
};

async function searchPeople(page: Page, value: string) {
  await UI.search(page).fill(value);
  await UI.submitSearch(page).click();
}

function assertNoUnplannedCalls(state: Awaited<ReturnType<typeof installPeopleFixture>>) {
  expect(state.writes, 'Browsing and opening Update member must not write').toEqual([]);
  expect(state.consoleErrors, 'React rendering must not report browser console errors').toEqual([]);
  expect(
    state.unexpectedReads,
    'Add an explicit fixture when a real read contract is required',
  ).toEqual([]);
}

async function assertWidth(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await UI.workspace(page).evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
}

async function assertPanelBounds(page: Page, panel: Locator) {
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('Panel geometry unavailable');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await panel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
    1,
  );
  await expect(panel.getByRole('button', { name: 'Close panel', exact: true })).toBeInViewport();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 646, height: 698 },
  { width: 390, height: 844 },
]) {
  test(`People exposes all 517 identities and an accessible member panel at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const state = await installPeopleFixture(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/admin/department?as_of=${PEOPLE_DATE}`);
    await expect(UI.workspace(page)).toBeVisible();
    await expect(UI.date(page)).toHaveValue(PEOPLE_DATE);
    await expect(UI.rows(page).first()).toBeVisible();
    await expect(UI.previous(page)).toBeDisabled();
    await expect(UI.workspace(page)).toContainText(employeeId(1));
    await assertWidth(page);

    // API page metadata governs the expected records; no fixed UI page-size assumption.
    const seen = new Set<number>();
    for (let pageNumber = 1; pageNumber <= PEOPLE_COUNT; pageNumber += 1) {
      await expect.poll(() => state.listRequests.at(-1)?.page).toBe(pageNumber);
      const response = state.listRequests.at(-1);
      if (!response) throw new Error('People list request missing');
      expect(response.total).toBe(PEOPLE_COUNT);
      expect(response.pageSize).toBe(25);
      await expect(UI.rows(page)).toHaveCount(response.ids.length);
      const ids = await UI.rows(page).evaluateAll((rows) =>
        rows.map((row) => Number(row.getAttribute('data-member-id'))),
      );
      expect(ids).toEqual(response.ids);
      for (const id of ids) {
        expect(seen.has(id), 'A member must not repeat on a later API page').toBe(false);
        seen.add(id);
      }
      await assertWidth(page);
      if (pageNumber === response.totalPages) {
        await expect(UI.next(page)).toBeDisabled();
        break;
      }
      await expect(UI.next(page)).toBeEnabled();
      await UI.next(page).click();
    }
    expect([...seen]).toEqual(peopleSnapshot(PEOPLE_DATE).map((person) => person.id));
    await expect(UI.workspace(page)).toContainText(employeeId(PEOPLE_COUNT));
    await page.screenshot({
      path: info.outputPath(`department-last-page-${viewport.width}.png`),
      fullPage: true,
    });

    // Search reaches a record beyond 500 and resets the API page to 1.
    await searchPeople(page, employeeId(PEOPLE_COUNT));
    await expect.poll(() => state.listRequests.at(-1)?.search).toBe(employeeId(PEOPLE_COUNT));
    await expect(UI.rows(page)).toHaveCount(1);
    expect(state.listRequests.at(-1)?.page).toBe(1);
    await expect(UI.previous(page)).toBeDisabled();
    await expect(UI.next(page)).toBeDisabled();

    // Return to the long-name member, then operate the detail panel by keyboard.
    await searchPeople(page, employeeId(1));
    await expect(UI.rows(page)).toHaveCount(1);
    const trigger = UI.view(page, memberId(1));
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)memberId=${memberId(1)}(?:&|$)`));
    const panel = UI.memberPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(`${LONG_FIRST} ${LONG_LAST}`);
    await expect(panel).toContainText(employeeId(1));
    await expect(panel).toContainText('Synthetic advanced rescue certification');
    await expect(
      panel.getByRole('heading', { name: `${LONG_FIRST} ${LONG_LAST}`, exact: true }),
    ).toBeFocused();
    const updateTrigger = panel.getByRole('button', { name: 'Update member', exact: true });
    await updateTrigger.click();
    const update = page.getByRole('dialog', {
      name: `Update member — ${LONG_FIRST} ${LONG_LAST}`,
      exact: true,
    });
    await assertPanelBounds(page, update);
    for (let index = 0; index < 15; index += 1) {
      await page.keyboard.press(index % 2 === 0 ? 'Tab' : 'Shift+Tab');
      expect(await update.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`department-member-${viewport.width}.png`),
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(update).toHaveCount(0);
    await expect(updateTrigger).toBeFocused();
    expect(new URL(page.url()).searchParams.get('memberId')).toBe(String(memberId(1)));
    expect(errors).toEqual([]);
    assertNoUnplannedCalls(state);
  });
}

test('Member URL selects an off-page identity and date changes use a new server projection', async ({
  page,
}) => {
  const state = await installPeopleFixture(page);
  await page.goto(`/admin/department?memberId=${memberId(PEOPLE_COUNT)}`);
  const panel = UI.memberPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(employeeId(PEOPLE_COUNT));
  expect(state.detailRequests.some((request) => request.id === memberId(PEOPLE_COUNT))).toBe(true);
  await page.reload();
  await expect(UI.memberPanel(page)).toContainText(employeeId(PEOPLE_COUNT));

  await UI.date(page).fill(PEOPLE_DATE);
  await searchPeople(page, employeeId(1));
  await expect(UI.view(page, memberId(1))).toBeVisible();
  await UI.view(page, memberId(1)).click();
  await expect
    .poll(() => state.detailRequests.at(-1))
    .toEqual({ id: memberId(1), asOf: PEOPLE_DATE });
  await expect(UI.memberPanel(page)).toContainText(
    'Synthetic Special Operations Training Lieutenant',
  );
  // Scheduled future ledger evidence must remain visible before it becomes current state.
  await UI.memberPanel(page).locator('summary').filter({ hasText: 'Employment and rank' }).click();
  await expect(
    UI.memberPanel(page).getByText(
      'Synthetic scheduled retirement remains ledger evidence before its effective date',
    ),
  ).toBeVisible();
  await expect(UI.memberPanel(page)).toContainText(
    'Synthetic scheduled retirement remains ledger evidence before its effective date',
  );
  await UI.date(page).fill(AFTER_EVENT_DATE);
  await UI.submitSearch(page).click();
  await expect.poll(() => state.listRequests.at(-1)?.asOf).toBe(AFTER_EVENT_DATE);
  await UI.view(page, memberId(1)).click();
  await expect
    .poll(() => state.detailRequests.at(-1))
    .toEqual({ id: memberId(1), asOf: AFTER_EVENT_DATE });
  await expect(UI.memberPanel(page)).toContainText(/retired/i);
  assertNoUnplannedCalls(state);
});

test('Duplicate names remain distinct; status filtering and empty search use the full people endpoint', async ({
  page,
}) => {
  const state = await installPeopleFixture(page);
  await page.goto('/admin/department');
  await searchPeople(page, 'Synthetic Duplicate Same Name');
  await expect(UI.rows(page)).toHaveCount(2);
  await expect(UI.workspace(page)).toContainText(employeeId(7));
  await expect(UI.workspace(page)).toContainText(employeeId(8));
  await UI.view(page, memberId(8)).click();
  await expect(UI.memberPanel(page)).toContainText(employeeId(8));
  await searchPeople(page, '');
  await expect(UI.rows(page)).toHaveCount(25);
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
  await UI.status(page).selectOption('unknown');
  await UI.submitSearch(page).click();
  await expect.poll(() => state.listRequests.at(-1)?.employmentStatus).toBe('unknown');
  await expect(UI.rows(page)).toHaveCount(1);
  await expect(UI.workspace(page)).toContainText(employeeId(2));
  await searchPeople(page, 'synthetic-no-matching-person');
  await expect.poll(() => state.listRequests.at(-1)?.total).toBe(0);
  await expect(UI.rows(page)).toHaveCount(0);
  await expect(UI.previous(page)).toBeDisabled();
  await expect(UI.next(page)).toBeDisabled();
  assertNoUnplannedCalls(state);
});

test('Opening Update member offers the existing workflows without issuing a mutation', async ({
  page,
}) => {
  const state = await installPeopleFixture(page);
  await page.goto(`/admin/department?memberId=${memberId(1)}`);
  const details = UI.memberPanel(page);
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Update member', exact: true }).click();
  const update = page.getByRole('dialog', {
    name: `Update member — ${LONG_FIRST} ${LONG_LAST}`,
    exact: true,
  });
  await expect(update).toBeVisible();
  await assertPanelBounds(page, update);
  await page.keyboard.press('Escape');
  assertNoUnplannedCalls(state);
});

// Do not add successful mutation fixtures here. Real workflow completion and cache
// invalidation require the existing personnel/qualification writer contract tests.

for (const viewport of [
  { width: 646, height: 698 },
  { width: 390, height: 844 },
]) {
  test(`Mobile deep link brings the focused member heading into view at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const state = await installPeopleFixture(page);
    await page.goto(`/admin/department?as_of=${PEOPLE_DATE}&memberId=${memberId(1)}`);
    const heading = UI.memberPanel(page).getByRole('heading', {
      name: `${LONG_FIRST} ${LONG_LAST}`,
      exact: true,
    });
    await expect(heading).toBeFocused();
    await page.screenshot({ path: info.outputPath(`department-deep-link-${viewport.width}.png`) });
    await expect(heading).toBeInViewport();
    assertNoUnplannedCalls(state);
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 646, height: 698 },
  { width: 390, height: 844 },
]) {
  test(`Add member review is entered data and cancel records nothing at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const state = await installPeopleFixture(page);
    await page.goto(`/admin/department?as_of=${PEOPLE_DATE}`);
    const trigger = page.getByRole('button', { name: 'Add member', exact: true });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Add member', exact: true });
    await expect(panel).toBeVisible();
    await assertPanelBounds(page, panel);
    await expect(panel.getByLabel('Change type', { exact: true })).toHaveCount(0);
    await panel.getByLabel('Employee ID', { exact: true }).fill('SYNTHETIC-NEW-MEMBER');
    await panel.getByLabel('First name', { exact: true }).fill(LONG_FIRST);
    await panel.getByLabel('Last name', { exact: true }).fill(LONG_LAST);
    await panel.getByLabel('RSC seniority', { exact: true }).fill('518');
    await panel
      .getByLabel('Operator reason', { exact: true })
      .fill('Synthetic local entered review; cancellation must record nothing.');
    await panel.getByRole('button', { name: 'Review new member', exact: true }).click();
    const review = panel.getByRole('region', { name: 'Entered member details', exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText('SYNTHETIC-NEW-MEMBER');
    await expect(review).toContainText(LONG_FIRST);
    await expect(panel).toContainText('No member has been recorded');
    await expect(
      panel.getByRole('button', { name: 'Confirm and record new member', exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(`department-add-review-${viewport.width}.png`),
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(
      panel.getByText('Discard these unrecorded member details?', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(panel.getByLabel('First name', { exact: true })).toHaveValue(LONG_FIRST);
    await panel.getByRole('button', { name: 'Close panel', exact: true }).click();
    await panel.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await assertWidth(page);
    assertNoUnplannedCalls(state);
  });
}

test('Update member protects dirty branch changes and cancelling retains the selected identity', async ({
  page,
}) => {
  const state = await installPeopleFixture(page);
  await page.goto(`/admin/department?as_of=${PEOPLE_DATE}&memberId=${memberId(1)}`);
  await UI.memberPanel(page).getByRole('button', { name: 'Update member', exact: true }).click();
  const panel = page.getByRole('dialog', {
    name: `Update member — ${LONG_FIRST} ${LONG_LAST}`,
    exact: true,
  });
  const reason = panel.getByRole('textbox', { name: 'Operator reason', exact: true });
  await expect(
    panel.getByRole('combobox', { name: 'Staffing position (optional)', exact: true }),
  ).toBeVisible();
  await reason.fill('Synthetic unsaved member change');
  await panel.getByRole('button', { name: 'Credential change', exact: true }).click();
  await expect(
    panel.getByText('Discard the unrecorded changes in this form?', { exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(reason).toHaveValue('Synthetic unsaved member change');
  await panel.getByRole('button', { name: 'Credential change', exact: true }).click();
  await panel.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Credential change', exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Preview credential change', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('memberId')).toBe(String(memberId(1)));
  assertNoUnplannedCalls(state);
});

test('People and member detail loading state never substitutes another identity', async ({
  page,
}) => {
  const state = await installPeopleFixture(page);
  let releaseList = () => {};
  state.listGate = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.goto(`/admin/department?as_of=${PEOPLE_DATE}`);
  await expect(page.getByText('Loading Department people…', { exact: true })).toBeVisible();
  await expect(UI.rows(page)).toHaveCount(0);
  releaseList();
  await expect(UI.rows(page)).toHaveCount(25);
  await UI.view(page, memberId(7)).click();
  await expect(UI.memberPanel(page)).toContainText(employeeId(7));
  let releaseDetail = () => {};
  state.detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  await UI.view(page, memberId(8)).click();
  await expect(page.getByText('Loading member details…', { exact: true })).toBeVisible();
  await expect(UI.memberPanel(page)).toHaveCount(0);
  releaseDetail();
  await expect(UI.memberPanel(page)).toContainText(employeeId(8));
  await expect(UI.memberPanel(page)).not.toContainText(employeeId(7));
  assertNoUnplannedCalls(state);
});

test('People list and selected member errors offer working retries', async ({ page }, info) => {
  test.setTimeout(60_000);
  const state = await installPeopleFixture(page);
  state.failList = true;
  state.failDetails.add(memberId(1));
  await page.goto(`/admin/department?as_of=${PEOPLE_DATE}&memberId=${memberId(1)}`);
  const listRetry = page.getByRole('button', { name: 'Retry member list', exact: true });
  const detailRetry = page.getByRole('button', { name: 'Retry member details', exact: true });
  await expect(listRetry).toBeVisible({ timeout: 20_000 });
  await expect(detailRetry).toBeVisible({ timeout: 20_000 });
  await expect(UI.rows(page)).toHaveCount(0);
  await expect(UI.memberPanel(page)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('department-errors.png'), fullPage: true });
  state.failList = false;
  state.failDetails.clear();
  await listRetry.click();
  await detailRetry.click();
  await expect(UI.rows(page)).toHaveCount(25);
  await expect(UI.memberPanel(page)).toContainText(employeeId(1));
  await expect(listRetry).toHaveCount(0);
  await expect(detailRetry).toHaveCount(0);
  assertNoUnplannedCalls(state);
});

test('Credential definitions retry restores the catalog without a write', async ({ page }) => {
  test.setTimeout(60_000);
  const state = await installPeopleFixture(page);
  state.failCredentials = true;
  await page.goto('/admin/department/credentials');
  const retry = page.getByRole('button', { name: 'Retry credential definitions', exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  state.failCredentials = false;
  await retry.click();
  await expect(
    page.getByRole('heading', { name: 'Credential definitions', exact: true }),
  ).toBeVisible();
  assertNoUnplannedCalls(state);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 646, height: 698 },
  { width: 390, height: 844 },
]) {
  test(`Canonical Department roster, credential and import routes fit at ${viewport.width}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const state = await installPeopleFixture(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/admin/department/roster?as_of=${PEOPLE_DATE}`);
    await expect(
      page.getByRole('region', { name: 'Department roster', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Assignments & positions', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Department roster', exact: true }),
    ).toContainText('Synthetic Special Operations Training Lieutenant');
    const layoutEvidence = info.outputPath('roster-overflow-elements.json');
    await writeFile(
      layoutEvidence,
      JSON.stringify(
        await page.locator('main *').evaluateAll((nodes) =>
          nodes.flatMap((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width && rect.right > innerWidth + 1
              ? [
                  {
                    tag: node.tagName,
                    class: node.getAttribute('class'),
                    text: node.textContent?.slice(0, 180),
                    x: rect.x,
                    width: rect.width,
                    right: rect.right,
                  },
                ]
              : [];
          }),
        ),
        null,
        2,
      ),
    );
    await info.attach('roster-overflow-elements', {
      path: layoutEvidence,
      contentType: 'application/json',
    });
    expect
      .soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`department-roster-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Organization', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Organization', exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Department roster', exact: true }),
    ).toContainText('Synthetic Coastal Operations and Emergency Response Training Annex');
    expect
      .soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`department-organization-${viewport.width}.png`),
      fullPage: true,
    });
    await page.goto('/admin/department/credentials');
    await expect(
      page.getByRole('heading', { name: 'Credential definitions', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Credential catalog', exact: true }),
    ).toContainText('SYNTHETIC_RESCUE');
    await expect(
      page.getByRole('columnheader', { name: 'Default points', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Add credential', exact: true }).click();
    const credential = page.getByRole('dialog', { name: 'Add credential', exact: true });
    await assertPanelBounds(page, credential);
    await expect(credential.getByLabel('Default points', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`department-credentials-${viewport.width}.png`),
      fullPage: true,
    });
    await page.goto('/admin/department/import');
    // The heading is server-rendered; wait for the client read before taking a
    // screenshot so caret suppression cannot mutate inputs during hydration.
    await expect.poll(() => state.reads.includes('/api/admin/telestaff/imports')).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'Update staffing from TeleStaff', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`department-telestaff-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Import TargetSolutions', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/department\/import\?source=targetsolutions$/);
    await expect(page.getByRole('heading', { name: /TargetSolutions/ }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`department-targetsolutions-${viewport.width}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    assertNoUnplannedCalls(state);
  });
}
