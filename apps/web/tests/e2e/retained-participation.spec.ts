import { expect, test } from '@playwright/test';
import { retainedParticipationFixture } from '../fixtures/retained-participation';
import { authenticateCurrentBid } from './current-bid-fixtures';

// Real routed Next/React UI with explicit synthetic presentation responses.
// Worker integration tests separately prove immutable-source derivation/Save.
test('retained participation stays collapsed until reviewed and loads only a draft before normal Save', async ({
  page,
}, testInfo) => {
  const fixture = retainedParticipationFixture();
  const requests: { method: string; path: string; body: unknown; key: string | undefined }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await authenticateCurrentBid(page.context(), 'http://localhost:3000');
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ json: { token: 'csrf_11111111-1111-4111-8111-111111111111' } }),
  );
  await page.route('**/api/admin/annual-plan/2026', (route) =>
    route.fulfill({ json: { plan: { year: 2026, sessions: [] } } }),
  );
  await page.route('**/api/admin/bid/2026/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/admin/bid/2026/', '');
    requests.push({
      method: request.method(),
      path,
      body: request.method() === 'POST' ? request.postDataJSON() : null,
      key: request.headers()['idempotency-key'],
    });
    if (path === 'current') return route.fulfill({ json: fixture.base });
    if (path === 'my-mock') return route.fulfill({ json: { mock: null } });
    if (path === 'retained-participation/preview') return route.fulfill({ json: fixture.proposal });
    if (path === 'versions' && request.method() === 'POST')
      return route.fulfill({ status: 409, json: { error: 'synthetic_explicit_save_review' } });
    return route.fulfill({ status: 404, json: { error: 'synthetic_unexpected_request' } });
  });
  await page.goto('/admin/current-bid?year=2026');
  const workspace = page.getByRole('main').getByTestId('current-bid-workspace');
  const control = workspace
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^Reconcile retained participation$/ }) });
  await expect(control).toHaveCount(1);
  await expect(control).not.toHaveAttribute('open', '');
  expect(
    requests.filter((request) => request.path === 'retained-participation/preview'),
  ).toHaveLength(0);
  await control.locator('summary').first().click();
  await control.getByRole('button', { name: 'Review retained participation', exact: true }).click();
  const proposal = control.getByRole('region', { name: 'Retained participation proposal' });
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('222 → 218');
  await expect(proposal).toContainText('284 → 276');
  await expect(proposal).toContainText('Synthetic Retained Captain');
  await expect(proposal).toContainText('SYN-CPT-RETAINED · retained, closed to bidding');
  await proposal.getByText('Original source proof', { exact: true }).click();
  await expect(proposal).toContainText(fixture.proposal.source.freezeId);
  expect(await proposal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('retained-participation-synthetic-preview.png'),
    fullPage: false,
  });
  const preview = requests.find((request) => request.path === 'retained-participation/preview');
  expect(preview).toMatchObject({ method: 'POST', body: { expected: fixture.base.expected } });
  expect(preview?.key).toBeUndefined();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  await proposal
    .getByRole('button', { name: 'Load reviewed participation into draft', exact: true })
    .click();
  await expect(workspace).toContainText('Unsaved changes');
  await expect(
    workspace.getByRole('heading', { name: 'Review Participants & flow', exact: true }),
  ).toBeVisible();
  const draft = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(
      (candidate) => candidate.startsWith('mbfd-current-bid:v1:') && candidate.endsWith(':2026'),
    );
    return key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
  });
  expect(draft?.content).toEqual(fixture.proposal.content);
  expect(draft?.base.content).toEqual(fixture.base.content);
  expect(draft?.pending).toBeNull();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  await workspace.getByRole('button', { name: 'Save Bid', exact: true }).click();
  await expect(workspace.getByRole('alert')).toContainText('synthetic explicit save review');
  const save = requests.find((request) => request.path === 'versions');
  expect(save?.body).toMatchObject({
    expected: fixture.base.expected,
    content: fixture.proposal.content,
  });
  expect(save?.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    requests.some((request) => /mock-sessions|live-sessions|commands|start/.test(request.path)),
  ).toBe(false);
  expect(errors).toEqual([]);
});
