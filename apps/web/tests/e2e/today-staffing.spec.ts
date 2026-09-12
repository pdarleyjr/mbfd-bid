import type { DepartmentRosterPosition, DepartmentRosterProjection } from '@mbfd/shared';
import { type Page, expect, test } from '@playwright/test';
import { CompactSign } from 'jose';
import { groupRoster, paginateRoster } from '../../app/admin/today/roster-pagination';

// Deliberately synthetic geometry fixtures. These records never reach a Worker writer.
const LONG_STATION = 'Synthetic Coastal Operations and Emergency Response Training Annex';
const LONG_MEMBER = 'Synthetic Alexandria Catherine Montgomery-Wellington';

function syntheticPosition(index: number, shift: string): DepartmentRosterPosition {
  const vacant = index % 17 === 16;
  const memberId = 91000 + index + (shift === 'E' ? 1000 : 0);
  const id = `synthetic-today-${shift}-${index}`;
  return {
    id,
    stableSlotKey: id,
    division: 'Synthetic Operations',
    shift,
    station: index < 8 ? LONG_STATION : `Synthetic Station ${Math.floor(index / 8) + 7}`,
    unit: index % 3 === 0 ? 'Synthetic Special Operations Rescue and Logistics Unit' : 'Engine 7',
    positionName:
      index % 3 === 0 ? 'Synthetic Special Operations Training Lieutenant' : 'Firefighter',
    applicableRank: index % 3 === 0 ? 'LT' : 'FF',
    reviewStatus: 'approved',
    occupancy: vacant ? 'vacant' : 'occupied',
    temporaryContext: [],
    assignment: vacant
      ? null
      : {
          id: `assignment-${id}`,
          memberId,
          originType: 'ADMIN_TRANSFER',
          status: 'active',
          effectiveFrom: '2026-09-01',
          effectiveTo: null,
        },
    member: vacant
      ? null
      : {
          id: memberId,
          employeeId: `SYNTHETIC-${shift}-${index}`,
          firstName: index === 0 ? 'Synthetic Alexandria Catherine' : 'Synthetic',
          lastName: index === 0 ? 'Montgomery-Wellington' : `Member ${shift} ${index}`,
          rank: index % 3 === 0 ? 'LT' : 'FF',
        },
  };
}

const positions = [
  ...Array.from({ length: 96 }, (_, index) => syntheticPosition(index, 'A')),
  ...Array.from({ length: 19 }, (_, index) => syntheticPosition(index, 'E')),
];
const occupiedPositions = positions.filter((position) => position.occupancy === 'occupied').length;
const roster: DepartmentRosterProjection = {
  organizationUnits: [
    {
      id: 'synthetic-empty-station',
      kind: 'STATION',
      name: 'Synthetic Station Without Positions',
      parentId: null,
      status: 'active',
      effectiveOn: '2026-09-01',
      revision: 1,
    },
    {
      id: 'synthetic-empty-group',
      kind: 'GROUP',
      name: 'Synthetic Group Without Positions',
      parentId: null,
      status: 'active',
      effectiveOn: '2026-09-01',
      revision: 1,
    },
    {
      id: 'synthetic-empty-apparatus',
      kind: 'APPARATUS',
      name: 'Synthetic Apparatus Without Positions',
      parentId: 'synthetic-empty-station',
      status: 'active',
      effectiveOn: '2026-09-01',
      revision: 1,
    },
  ],
  asOf: '2026-09-12',
  updatedAt: Date.UTC(2026, 8, 12, 12),
  positions,
  summary: {
    totalPositions: positions.length,
    occupiedPositions,
    vacantPositions: positions.length - occupiedPositions,
  },
  unassignedMembers: [],
};

test('measured pagination preserves every position and distinct organization identities', () => {
  const sameLabel = [syntheticPosition(0, 'A'), syntheticPosition(1, 'A')].map(
    (position, index) => ({
      ...position,
      station: 'Synthetic identical station label',
      unit: 'Synthetic identical unit label',
      organization: {
        organizationUnitId: `synthetic-organization-${index}`,
        stationId: `synthetic-station-${index}`,
        groupId: null,
        unitId: `synthetic-unit-${index}`,
      },
    }),
  );
  expect(groupRoster(sameLabel)).toHaveLength(2);
  const groups = groupRoster(positions);
  const measurements = {
    headings: Object.fromEntries(groups.map((group, index) => [group.id, 40 + (index % 3) * 10])),
    rows: Object.fromEntries(
      positions.map((position, index) => [position.id, 30 + (index % 4) * 10]),
    ),
  };
  for (const height of [160, 240, 420]) {
    for (const columns of [1, 2, 4]) {
      const result = paginateRoster(groups, measurements, height, columns);
      expect(result.oversizedPositionIds).toEqual([]);
      expect(
        result.pages
          .flat(2)
          .flatMap((fragment) => fragment.positions.map((position) => position.id)),
      ).toEqual(groups.flatMap((group) => group.positions.map((position) => position.id)));
      for (const column of result.pages.flat()) {
        const used =
          column.reduce((sum, fragment) => sum + fragment.height, 0) +
          Math.max(0, column.length - 1) * 12;
        expect(used).toBeLessThanOrEqual(height);
      }
    }
  }
});

async function isolatedOperator(page: Page) {
  const key = process.env.JWT_SIGNING_KEY;
  if (!key) throw new Error('An explicit isolated JWT_SIGNING_KEY is required');
  const writes: string[] = [];
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.route('**/api/admin/department/current-roster*', (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(`${route.request().method()} /api/admin/department/current-roster`);
      return route.abort();
    }
    return route.fulfill({ json: roster });
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-today-operator',
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
  return writes;
}

async function assertGeometry(page: Page, desktop: boolean) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  if (!desktop) return;
  const geometry = await page.getByTestId('today-roster').evaluate((element) => {
    const main = element.closest('main');
    if (!main) throw new Error('Today must be inside the application main content');
    const mainBounds = main.getBoundingClientRect();
    const rosterBounds = element.getBoundingClientRect();
    const clippedRows = Array.from(element.querySelectorAll('[data-position-id]')).flatMap(
      (row) => {
        const bounds = row.getBoundingClientRect();
        return bounds.top < Math.max(mainBounds.top, rosterBounds.top) - 1 ||
          bounds.bottom > Math.min(mainBounds.bottom, rosterBounds.bottom, innerHeight) + 1 ||
          bounds.left < rosterBounds.left - 1 ||
          bounds.right > rosterBounds.right + 1
          ? [row.getAttribute('data-position-id')]
          : [];
      },
    );
    const nestedOverflow = [element, ...Array.from(element.querySelectorAll('*'))]
      .filter((node) => {
        const style = getComputedStyle(node);
        return (
          ['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1
        );
      })
      .map((node) => node.getAttribute('data-testid') ?? node.tagName);
    return {
      mainOverflow: main.scrollHeight - main.clientHeight,
      rosterOverflow: element.scrollHeight - element.clientHeight,
      bottom: rosterBounds.bottom,
      visibleBottom: Math.min(mainBounds.bottom, innerHeight),
      clippedRows,
      nestedOverflow,
    };
  });
  expect(
    geometry.mainOverflow,
    'Desktop Today must not scroll the application main',
  ).toBeLessThanOrEqual(1);
  expect(
    geometry.rosterOverflow,
    'Desktop roster must fit without a hidden overflow area',
  ).toBeLessThanOrEqual(1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom + 1);
  expect(
    geometry.clippedRows,
    'Every rendered position must remain inside the visible roster',
  ).toEqual([]);
  expect(
    geometry.nestedOverflow,
    'Desktop roster must not introduce nested vertical scrolling',
  ).toEqual([]);
}

async function visitEveryPosition(page: Page, shift: string, desktop: boolean) {
  await page.getByRole('combobox', { name: 'Shift', exact: true }).selectOption(shift);
  const workspace = page.getByTestId('today-workspace');
  const rows = page.getByTestId('today-roster').locator('[data-position-id]');
  const previous = workspace.getByRole('button', { name: 'Previous roster page', exact: true });
  const next = workspace.getByRole('button', { name: 'Next roster page', exact: true });
  await expect(previous).toBeDisabled();
  const expected = positions
    .filter((position) => position.shift === shift)
    .map((position) => position.id);
  const seen = new Set<string>();
  let pageCount = 0;
  while (pageCount <= expected.length) {
    await expect(rows.first()).toBeVisible();
    await assertGeometry(page, desktop);
    const current = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-position-id') ?? ''),
    );
    expect(current.length).toBeGreaterThan(0);
    for (const id of current) {
      expect(expected).toContain(id);
      expect(seen.has(id), `Position ${id} must not repeat between roster pages`).toBe(false);
      seen.add(id);
    }
    pageCount += 1;
    if (await next.isDisabled()) break;
    const oldPage = current.join('|');
    await next.click();
    await expect
      .poll(async () =>
        rows.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-position-id')).join('|'),
        ),
      )
      .not.toBe(oldPage);
  }
  expect(pageCount, 'Pagination must terminate').toBeLessThanOrEqual(expected.length);
  expect([...seen].sort()).toEqual([...expected].sort());
  await expect(next).toBeDisabled();
  if (desktop && shift === 'A')
    expect(pageCount, 'Large rosters require explicit additional pages').toBeGreaterThan(1);
  if (pageCount > 1) {
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(next).toBeEnabled();
  }
}

for (const viewport of [
  { width: 1857, height: 970 },
  { width: 1440, height: 900 },
  { width: 646, height: 698 },
  { width: 390, height: 844 },
]) {
  test(`Today preserves complete dynamic staffing at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const writes = await isolatedOperator(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/admin');
    await expect(page.getByTestId('today-workspace')).toBeVisible();
    await expect(
      page.getByTestId('today-roster').locator('[data-position-id]').first(),
    ).toBeVisible();
    const desktop = viewport.width >= 1440;
    await assertGeometry(page, desktop);
    await expect(page.getByTestId('today-workspace')).toContainText(LONG_STATION);
    await expect(page.getByTestId('today-workspace')).toContainText(LONG_MEMBER);
    await page.screenshot({ path: info.outputPath(`today-${viewport.width}.png`), fullPage: true });
    await visitEveryPosition(page, 'A', desktop);
    await visitEveryPosition(page, 'E', desktop);
    await page.screenshot({
      path: info.outputPath(`today-custom-shift-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Organization', exact: true }).click();
    const organizationPanel = page.getByRole('dialog', {
      name: 'Department organization',
      exact: true,
    });
    await expect(organizationPanel).toBeVisible();
    for (const unit of roster.organizationUnits ?? []) {
      await expect(
        organizationPanel.getByRole('heading', { name: unit.name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      organizationPanel.getByText('No staffing positions linked for this shift', { exact: true }),
    ).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(organizationPanel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Organization', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}

test('an oversized record widens before exposing complete temporary context in an accessible panel', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes = await isolatedOperator(page);
  const extreme = {
    ...syntheticPosition(0, 'A'),
    station: 'Synthetic Emergency Operations and Training Campus With A Long Configured Name',
    unit: `Synthetic${'UnbrokenApparatusLabel'.repeat(24)}`,
    temporaryContext: Array.from({ length: 40 }, (_, index) => ({
      id: `synthetic-extreme-overlay-${index}`,
      kind: 'LIGHT_DUTY' as const,
      effectiveOn: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      plannedEndOn: index === 39 ? '2026-12-31' : null,
      actualEndOn: null,
    })),
  };
  await page.route('**/api/admin/department/current-roster*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            ...roster,
            positions: [extreme],
            summary: { totalPositions: 1, occupiedPositions: 1, vacantPositions: 0 },
          },
        })
      : route.abort(),
  );
  await page.goto('/admin');
  const row = page.getByTestId('today-roster').locator(`[data-position-id="${extreme.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(LONG_MEMBER);
  await expect(row).toContainText(extreme.positionName ?? '');
  await assertGeometry(page, true);
  const details = row.getByRole('button', { name: 'View assignment details (40)', exact: true });
  await expect(details).toBeInViewport();
  await page.screenshot({ path: info.outputPath('today-extreme-record.png'), fullPage: true });
  await details.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Staffing record details', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^Light duty from/)).toHaveCount(40);
  const lastContext = panel.getByText('Light duty from 2026-02-09 · planned through 2026-12-31', {
    exact: true,
  });
  await lastContext.scrollIntoViewIfNeeded();
  await expect(lastContext).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('today-extreme-record-details.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(details).toBeFocused();
  expect(writes).toEqual([]);
});
