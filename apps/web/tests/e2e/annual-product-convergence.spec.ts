import { type Page, expect, test } from '@playwright/test';
import { SignJWT } from 'jose';

async function setPin(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'mbfd_pin',
      value: 'ok',
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

async function setAdmin(page: Page): Promise<boolean> {
  const signingKey = process.env.JWT_SIGNING_KEY;
  if (!signingKey) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    sub: 901,
    hub_user_id: 901,
    member_id: 901,
    emp: 'e2e-annual-admin',
    role: 'admin',
    security_version: 1,
    rank: 'CPT',
    first_name: 'Annual',
    last_name: 'Operator',
    fresh_auth_at: nowSec,
    authz_checked_at: nowSec,
  } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(signingKey));
  await setPin(page);
  await page.context().addCookies([
    {
      name: 'mbfd_bid_jwt',
      value: jwt,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  return true;
}

test('department presentation stays read-only across OFF, LIVE, and held snapshots', async ({
  page,
}) => {
  await setPin(page);
  let mode: 'LIVE' | 'HOLD' = 'LIVE';
  await page.route('**/api/presentation', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode,
        held_at_sequence: mode === 'HOLD' ? 41 : null,
        sequence: mode === 'HOLD' ? 41 : 44,
        session: { id: 'annual-live-e2e', bid_year: 2027 },
        current_stage: { id: 'abc-ff', label: 'ABC Firefighter' },
        current_bidder: { member_id: 12, name: 'Alex Member', rank: 'FF' },
        on_deck: [{ member_id: 13, name: 'Jordan Member', rank: 'FF' }],
        phase: 'position_bid',
        paused: false,
        complete: false,
        progress: { filled: 1, total: 2 },
        positions: [
          {
            id: 'A101',
            shift: 'A',
            station: '1',
            unit: 'Engine 1',
            position_name: 'Firefighter',
            rank_required: 'FF',
            filled_by: { member_id: 14, name: 'Taylor Member', rank: 'FF' },
          },
        ],
        specialty: null,
      }),
    });
  });

  await page.goto('/live');
  await expect(page.getByRole('heading', { name: 'Presentation is off' })).toBeVisible();
  await expect(page.getByTestId('department-presentation')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('LIVE DISPLAY')).toBeVisible();
  await expect(page.getByText('Alex Member')).toBeVisible();
  await expect(page.getByTestId('department-presentation').getByRole('button')).toHaveCount(0);

  mode = 'HOLD';
  await expect(page.getByText('DISPLAY HELD · SEQ 41')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Alex Member')).toBeVisible();
  await expect(page.getByTestId('department-presentation').getByRole('button')).toHaveCount(0);
});

test('annual policy editor starts blocking and loads only real source members and positions', async ({
  page,
}) => {
  if (!(await setAdmin(page))) {
    test.skip(true, 'No JWT_SIGNING_KEY — cannot exercise the authenticated policy editor');
    return;
  }
  await page.route('**/api/admin/annual-policy-documents/2027/editor-data', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rule_book_version: '2027-approved-candidate',
        configuration_revision: 3,
        credential_evaluation_on: '2027-01-01',
        members: [
          {
            member_id: 21,
            first_name: 'Avery',
            last_name: 'Firefighter',
            rank: 'FF',
            pool: 'FF',
            rsc_seniority: 100,
            rank_seniority: 100,
            credential_names: ['Marine'],
            specialty_qualification_codes: ['MARINE'],
          },
          {
            member_id: 1,
            first_name: 'Command',
            last_name: 'Operator',
            rank: 'CPT',
            pool: 'EXCLUDED',
            rsc_seniority: 1,
            rank_seniority: 1,
            credential_names: [],
            specialty_qualification_codes: [],
          },
        ],
        positions: [
          {
            id: 'A101',
            shift: 'A',
            station: '1',
            unit: 'Engine 1',
            rank_required: 'FF',
            position_name: 'Firefighter',
          },
        ],
      }),
    });
  });

  await page.goto('/admin/annual-policy?year=2027');
  await expect(page.getByText('NOT CONFIGURED — BLOCKING')).toBeVisible();
  await expect(page.locator('input[readonly]')).toHaveValue('2027-approved-candidate');
  await page.getByRole('button', { name: 'Add stage' }).click();
  await expect(page.getByRole('option', { name: /Firefighter, Avery.*RSC 100/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /A101.*Engine 1.*FF/ })).toBeVisible();
  await expect(page.getByText('POLICY_STAGE_')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save new draft revision' })).toBeDisabled();
});

test('specialty operator sees frozen ranking, contact state, resume state, and can dispatch', async ({
  page,
}) => {
  if (!(await setAdmin(page))) {
    test.skip(true, 'No JWT_SIGNING_KEY — cannot exercise the authenticated specialty operator');
    return;
  }
  const csrfToken = 'csrf_123e4567-e89b-12d3-a456-426614174000';
  const dispatched: Array<{ body: Record<string, unknown>; csrf: string | null }> = [];
  await page.route('**/api/auth/csrf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: csrfToken }),
    });
  });
  await page.route('**/api/admin/bid-session/annual-specialty-e2e/commands/live', async (route) => {
    const request = route.request();
    dispatched.push({
      body: request.postDataJSON() as Record<string, unknown>,
      csrf: request.headers()['x-mbfd-csrf'] ?? null,
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'accepted', seq: 4 }),
    });
  });

  await page.goto('/admin/bid?session_id=annual-specialty-e2e');
  const controls = page.getByTestId('annual-live-controls');
  await expect(controls).toBeVisible();
  await expect(controls.getByText(/Original bidder: FF Alex Original/)).toContainText(
    '3 points · policy rank 2',
  );
  const candidateRow = controls.getByRole('row').filter({ hasText: 'Jordan Candidate' });
  await expect(candidateRow).toContainText('8 / 1');
  await expect(candidateRow).toContainText('CURRENT');
  await expect(controls.getByText(/turn suspended at queue 0/)).toBeVisible();
  await expect(controls.getByRole('button', { name: 'ACCEPT' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'DECLINE' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'UNREACHABLE' })).toBeVisible();

  await controls.getByLabel('Operator reason').fill('Record the frozen priority contact attempt.');
  await controls.getByLabel('Evidence reference (when policy requires)').fill('contact-log-e2e');
  await controls.getByRole('button', { name: 'Record PHONE' }).click();
  await expect(controls.getByText('Canonical live command accepted.')).toBeVisible();
  await expect.poll(() => dispatched.length).toBe(1);
  expect(dispatched[0]).toMatchObject({
    body: { type: 'live.record_contact_attempt', memberId: 2, method: 'PHONE' },
    csrf: csrfToken,
  });

  await controls.getByRole('button', { name: 'HOLD DISPLAY' }).click();
  await expect(controls.getByText('Canonical live command accepted.')).toBeVisible();
  await expect.poll(() => dispatched.length).toBe(2);
  expect(dispatched[1]).toMatchObject({
    body: { type: 'live.set_presentation_mode', mode: 'HOLD' },
    csrf: csrfToken,
  });
});
