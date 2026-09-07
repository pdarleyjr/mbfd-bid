import { expect, test } from '@playwright/test';
import { CompactSign } from 'jose';

test('specialty grouped scoring preserves alternatives, prerequisites and channel selection on save retry', async ({
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
        emp: 'synthetic-policy-operator',
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
    route.fulfill({ json: { token: 'csrf_11111111-1111-1111-1111-111111111111' } }),
  );
  await page.route('**/api/admin/annual-policy-documents/2088/editor-data', (route) =>
    route.fulfill({
      json: {
        rule_book_version: '2088.1',
        configuration_revision: 1,
        rule_book_revision: 1,
        source_revision: 1,
        managed_annual_plan: true,
        credential_evaluation_on: '2088-01-01',
        members: [
          {
            member_id: 901,
            first_name: 'Synthetic',
            last_name: 'Operator',
            rank: 'CPT',
            pool: 'OFC',
            rsc_seniority: 1,
            rank_seniority: 1,
            credential_names: ['Synthetic Base'],
            specialty_qualification_codes: [],
          },
        ],
        positions: [
          {
            id: 'synthetic-seat',
            shift: 'A',
            station: 'Synthetic station',
            unit: 'Synthetic unit',
            rank_required: 'CPT',
            position_name: 'Synthetic Captain',
          },
        ],
      },
    }),
  );
  await page.route('**/api/admin/credentials?**', (route) =>
    route.fulfill({
      json: {
        credentials: ['Base', 'Alternative', 'Prerequisite'].map((name, index) => ({
          id: index + 1,
          name: `Synthetic ${name}`,
          policyName: `Synthetic ${name}`,
          retiredOn: null,
        })),
        total: 3,
      },
    }),
  );
  const writes: { key: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/annual-policy-documents/2088', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON(),
    });
    if (writes.length === 1) return route.abort('failed');
    return route.fulfill({ json: { id: 'synthetic-saved-document', revision: 2, replayed: true } });
  });
  await page.goto('/admin/annual-policy?year=2088');
  await expect(page.getByLabel('Configured rule book', { exact: true })).toHaveValue('2088.1');
  await page.getByText('Revision 1 · DRAFT', { exact: true }).click();
  await page.getByRole('button', { name: 'Load as new draft', exact: true }).click();
  await page.getByLabel('Executable policy revision', { exact: true }).fill('synthetic-policy-2');
  await page
    .getByRole('button', { name: 'Configure grouped specialty scoring', exact: true })
    .click();
  await page.getByLabel('Group cap (blank means uncapped)', { exact: true }).fill('5');
  await page.getByLabel('Points', { exact: true }).fill('4');
  await page
    .getByRole('listbox', { name: 'Reviewed alternatives (any one qualifies)', exact: true })
    .selectOption('Synthetic Alternative');
  await page
    .getByRole('listbox', { name: 'Required before credit (all must be held)', exact: true })
    .selectOption('Synthetic Prerequisite');
  await page
    .getByRole('combobox', { name: 'Specialty ranking channel', exact: true })
    .selectOption('so');
  await page
    .getByRole('button', { name: 'Add group for special operations points', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add scoring item', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Credential', exact: true })
    .selectOption('Synthetic Base');
  await page.getByLabel('Points', { exact: true }).fill('3');
  await page
    .getByRole('combobox', { name: 'Specialty ranking channel', exact: true })
    .selectOption('total');
  await expect(page.getByLabel('Points', { exact: true })).toHaveValue('4');
  await expect(
    page.getByRole('listbox', { name: 'Reviewed alternatives (any one qualifies)', exact: true }),
  ).toHaveValues(['Synthetic Alternative']);
  await expect(
    page.getByRole('listbox', { name: 'Required before credit (all must be held)', exact: true }),
  ).toHaveValues(['Synthetic Prerequisite']);
  // Install after hydration, when Next owns its history state.
  const historySupport = await page.evaluate(() => {
    history.pushState(history.state, '', '/admin/annual-policy?year=2088&review=synthetic');
    const surface = window as Window & { navigation?: EventTarget; __historyEvents?: unknown[] };
    surface.__historyEvents = [];
    surface.navigation?.addEventListener('navigate', (event) => {
      const e = event as Event & {
        navigationType: string;
        destination: { url: string; sameDocument: boolean };
      };
      surface.__historyEvents?.push({
        type: e.navigationType,
        cancelable: e.cancelable,
        destination: e.destination.url,
        sameDocument: e.destination.sameDocument,
      });
    });
    return { navigation: !!surface.navigation, url: location.href };
  });
  const historyPrompt = page.waitForEvent('dialog', { timeout: 8000 });
  const goingBack = page.evaluate(() => history.back());
  const prompt = await historyPrompt.catch(async (error) => {
    console.info(
      'History guard diagnostics',
      historySupport,
      await page.evaluate(
        () => (window as Window & { __historyEvents?: unknown[] }).__historyEvents,
      ),
    );
    throw error;
  });
  expect(prompt.message()).toContain('Discard unsaved annual operating policy');
  await prompt.dismiss();
  await goingBack;
  await expect(page).toHaveURL(/review=synthetic/);
  await expect(page.getByLabel('Points', { exact: true })).toHaveValue('4');
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole('heading', { name: 'Specialty policy', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`specialty-scoring-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole('combobox', { name: 'Specialty ranking channel', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`specialty-editor-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page
    .getByLabel('Revision reason', { exact: true })
    .fill('Synthetic grouped scoring review');
  await page.getByRole('button', { name: 'Save new draft revision', exact: true }).click();
  await expect(page.getByText(/fetch|network/i).last()).toBeVisible();
  await page.getByRole('button', { name: 'Save new draft revision', exact: true }).click();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  const policy = writes[1]?.body.execution_policy as {
    annualOperations: {
      specialties: {
        points: unknown[];
        rankingChannel: string;
        scoring: { total: unknown[]; so: unknown[]; mo: unknown[] };
      }[];
    };
  };
  expect(policy.annualOperations.specialties[0]).toMatchObject({
    points: [],
    rankingChannel: 'total',
    scoring: {
      total: [
        {
          cap: 5,
          items: [
            {
              credential: 'Synthetic Base',
              points: 4,
              alternatives: ['Synthetic Alternative'],
              requiresAll: ['Synthetic Prerequisite'],
            },
          ],
        },
      ],
      so: [{ items: [{ credential: 'Synthetic Base', points: 3 }] }],
      mo: [],
    },
  });
  expect(errors).toEqual([]);
});
