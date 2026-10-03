import { type Page, expect, test } from '@playwright/test';

const shifts = ['A', 'B', 'C', 'D'];
const fixtureSeats = shifts.flatMap((shift) =>
  Array.from({ length: shift === 'D' ? 8 : 74 }, (_, index) => ({
    id: `${shift}${index + 101}`,
    shift,
    station:
      index < 21 ? '1' : index < 38 ? '2' : index < 56 ? '3' : index < 69 ? '4' : 'Rescue Float',
    unit: index < 4 ? 'Ladder 1' : 'Engine 1',
    position_name: index % 7 === 0 ? 'Driver Engineer' : 'Firefighter',
    rank_required: 'FF',
    filled_by:
      index % 3 === 0
        ? {
            member_id: index + 200,
            name: index === 0 ? 'Jordan Christopher Longname' : `Assigned Member ${index + 1}`,
            rank: 'FF',
          }
        : null,
    forced: index === 3,
  })),
);

async function mountPresentation(page: Page, pendingADay = false) {
  const currentName = pendingADay ? 'Jordan Christopher Longname' : 'Current Captain';
  await page.context().addCookies([
    {
      name: 'mbfd_pin',
      value: 'ok',
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.route('**/api/presentation?bidSessionId=responsive-mock', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'LIVE',
        sequence: 20,
        session: { id: 'responsive-mock', bid_year: 2026, is_mock: true },
        current_stage: { id: 'combat-ff', label: 'Combat Firefighters' },
        current_bidder: {
          member_id: 1,
          name: currentName,
          rank: 'CPT',
          pending_a_day: pendingADay,
          current_assignment: {
            position_id: 'synthetic-staffing-position-key',
            shift: 'B',
            station: 'Station 4',
            unit: 'Engine 4',
            position_name: 'Captain',
          },
        },
        on_deck: [{ member_id: 2, name: 'On Deck Lieutenant', rank: 'LT' }],
        remaining_queue: Array.from({ length: 218 }, (_, index) => ({
          member_id: index + 1,
          name:
            index === 0
              ? currentName
              : index === 1
                ? 'On Deck Lieutenant'
                : `Remaining Member ${index + 1}`,
          rank: index < 20 ? 'CPT' : 'FF',
          pending_a_day: index === 2 || (index === 0 && pendingADay),
        })),
        exceptional_assignments: [
          {
            member_id: 999,
            name: 'Chief-directed Captain',
            rank: 'CPT',
            role_label: 'Division Chief of Prevention',
            forced: true,
          },
        ],
        phase: 'position_bid',
        progress: { filled: 78, total: 230 },
        positions: fixtureSeats,
      }),
    }),
  );
  await page.goto('/live?bidSessionId=responsive-mock');
  await expect(page.getByTestId('department-presentation')).toBeVisible({ timeout: 7000 });
  await expect(page.getByTestId('presentation-current-bidder')).toContainText(
    'Current seat: B Shift · Station 4 · Engine 4 · Captain',
  );
  await expect(page.getByTestId('presentation-current-bidder')).not.toContainText(
    'synthetic-staffing-position-key',
  );
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`deferred A-Day presentation header fits ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
    });
    await mountPresentation(page, true);
    const bidder = page.getByTestId('presentation-current-bidder');
    await expect(bidder).toContainText('Jordan Christopher Longname');
    await expect(bidder).toContainText('CPT');
    await expect(bidder).toContainText('Current seat: B Shift');
    await expect(bidder).toContainText('A-Day due');
    await page.screenshot({ path: testInfo.outputPath('presentation-deferred-a-day.png') });
    await assertFitsFrame(page);
    await page.getByRole('button', { name: 'Next seats', exact: true }).click();
    await assertFitsFrame(page);
    await page.getByRole('button', { name: 'Next shift', exact: true }).click();
    await assertFitsFrame(page);
    await page.getByRole('button', { name: 'Open remaining bidders', exact: true }).click();
    const queue = page.getByRole('complementary', { name: 'Remaining bidders' });
    await expect(queue.locator('[aria-current="true"]')).toContainText(
      'Jordan Christopher Longname',
    );
    await expect(queue.locator('[aria-current="true"]')).toContainText('A-Day due');
    await assertFitsFrame(page);
    expect(writes).toEqual([]);
  });
}

async function assertFitsFrame(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const frame = document.querySelector('[data-testid="presentation-frame"]');
        if (!frame) return ['frame missing'];
        const bounds = frame.getBoundingClientRect();
        const problems: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1)
          problems.push('horizontal page scrolling');
        if (document.documentElement.scrollHeight > window.innerHeight + 1)
          problems.push('vertical page scrolling');
        for (const element of frame.querySelectorAll(
          '[data-testid="presentation-seat"], [data-testid="presentation-queue-member"], button, h1, [data-testid="presentation-current-bidder"], [data-testid="presentation-current-bidder"] strong, [data-testid="presentation-current-bidder"] span, [data-testid="presentation-current-bidder"] p, [data-testid="presentation-on-deck"], [data-testid="presentation-header"] > *',
        )) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          if (
            rect.right > bounds.right + 1 ||
            rect.left < bounds.left - 1 ||
            rect.bottom > bounds.bottom + 1 ||
            rect.top < bounds.top - 1
          )
            problems.push(`${element.textContent?.slice(0, 60)} outside frame`);
          // Font ink can extend beyond a line box with visible overflow. It is
          // clipped only when this element actually clips or scrolls that ink.
          if (
            getComputedStyle(element).overflowY !== 'visible' &&
            (element as HTMLElement).scrollHeight > (element as HTMLElement).clientHeight + 1
          )
            problems.push(`${element.textContent?.slice(0, 60)} clipped vertically`);
          if (element.matches('button') && (rect.width < 44 || rect.height < 44))
            problems.push('small touch target');
          if (
            element.matches(
              '[data-testid="presentation-current-bidder"] strong, [data-testid="presentation-current-bidder"] span, [data-testid="presentation-current-bidder"] p',
            )
          ) {
            const textRange = document.createRange();
            textRange.selectNodeContents(element);
            for (const textBounds of textRange.getClientRects()) {
              if (
                textBounds.right > bounds.right + 1 ||
                textBounds.left < bounds.left - 1 ||
                textBounds.bottom > bounds.bottom + 1 ||
                textBounds.top < bounds.top - 1
              )
                problems.push(`${element.textContent?.slice(0, 60)} text outside frame`);
            }
          }
        }
        return problems;
      }),
    )
    .toEqual([]);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test(`presentation fits ${viewport.width}x${viewport.height} with all seats and a paginated queue`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
    });
    await mountPresentation(page);
    await assertFitsFrame(page);
    await page.screenshot({ path: testInfo.outputPath('presentation.png') });
    const seen = new Set<string>();
    for (const shift of shifts) {
      await expect(
        page.getByRole('heading', { name: shift === 'D' ? 'Days' : `${shift} Shift`, exact: true }),
      ).toBeVisible();
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        await assertFitsFrame(page);
        for (const id of await page
          .getByTestId('presentation-seat')
          .evaluateAll((seats) =>
            seats
              .map((seat) => seat.getAttribute('data-position-id'))
              .filter((id): id is string => id !== null),
          ))
          seen.add(id);
        const nextSeats = page.getByRole('button', { name: 'Next seats', exact: true });
        if (await nextSeats.isDisabled()) break;
        await nextSeats.click();
      }
      await page.getByRole('button', { name: 'Next shift', exact: true }).click();
    }
    expect([...seen].sort()).toEqual(fixtureSeats.map((seat) => seat.id).sort());
    if (await page.getByRole('button', { name: 'Open remaining bidders', exact: true }).count())
      await page.getByRole('button', { name: 'Open remaining bidders', exact: true }).click();
    const queue = page.getByRole('complementary', { name: 'Remaining bidders' });
    await expect(queue).toBeVisible();
    await assertFitsFrame(page);
    await expect(queue.locator('[aria-current="true"]')).toContainText('Current Captain');
    const onDeckLabel = queue.getByText(/· On deck$/);
    if (!(await onDeckLabel.isVisible()))
      await queue.getByRole('button', { name: 'Next bidders' }).click();
    await expect(onDeckLabel).toBeVisible();
    await assertFitsFrame(page);
    await queue.getByRole('button', { name: 'Next bidders' }).click();
    await assertFitsFrame(page);
    await queue.getByRole('button', { name: 'Close remaining bidders' }).click();
    await expect(queue).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Open remaining bidders', exact: true }),
    ).toBeFocused();
    expect(writes).toEqual([]);
  });
}
