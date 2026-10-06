import { expect, test } from '@playwright/test';
import { BID_CSRF, authenticateCurrentBid } from './current-bid-fixtures';

for (const enabled of [false, true])
  test(`final Portal Sync preview and confirmation with publication ${enabled ? 'enabled' : 'disabled'}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await authenticateCurrentBid(page.context(), 'http://localhost:3000');
    await page.route('**/*', (route) =>
      ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
        ? route.continue()
        : route.abort(),
    );
    await page.route('**/api/auth/csrf', (route) => route.fulfill({ json: { token: BID_CSRF } }));
    const writes: Array<{ operation: string; body: Record<string, unknown> }> = [];
    await page.route('**/api/admin/portal-final/synthetic-final-real/*', async (route) => {
      const operation = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
      writes.push({ operation, body: route.request().postDataJSON() });
      expect(route.request().headers()['x-mbfd-csrf']).toBe(BID_CSRF);
      await route.fulfill({
        json:
          operation === 'preview'
            ? {
                source_sequence: 123,
                source_result_hash: 'a'.repeat(64),
                manifest_sha256: 'b'.repeat(64),
                confirmation_phrase: 'PUBLISH FINAL synthetic confirmed sequence',
                publication_enabled: enabled,
                counts: { bid_award: 218, retained_nonbiddable: 8, total: 226, hub_matched: 226 },
                metadata_overrides: [
                  {
                    position_id: 'B703',
                    before: 'Lieutenant #3 (R)',
                    after: 'Firefighter #1',
                    reason: 'Reviewed exact final workbook source.',
                  },
                ],
              }
            : { ok: true },
      });
    });
    await page.goto('/admin/exports?session_id=synthetic-final-real');
    // Next may retain hidden streamed markup outside the accessible main.
    const application = page.locator('main.admin-exports:visible');
    await expect(application).toHaveCount(1);
    await application.getByText('Portal sync status', { exact: true }).first().click();
    await application.getByLabel('Private final source request (JSON)').setInputFiles({
      name: 'synthetic-source.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ expected_sequence: 123, rows: [] })),
    });
    await application
      .getByRole('button', { name: 'Preview final assignments', exact: true })
      .click();
    await expect(application.getByTestId('final-publication-preview')).toContainText(
      '218 awards · 8 retained assignments · 226 matched employees',
    );
    await expect(application.getByTestId('final-publication-preview')).toContainText(
      'Lieutenant #3 (R) → Firefighter #1',
    );
    const publish = application.getByRole('button', {
      name: 'Publish 226 final assignments',
      exact: true,
    });
    await expect(publish).toBeDisabled();
    if (enabled) {
      await application.locator('input[autocomplete=off]').fill('wrong phrase');
      await expect(publish).toBeDisabled();
      await application
        .locator('input[autocomplete=off]')
        .fill('PUBLISH FINAL synthetic confirmed sequence');
      await expect(publish).toBeEnabled();
      await publish.click();
      await expect(
        application.getByText('Final assignments are queued.', { exact: false }),
      ).toBeVisible();
      expect(writes.map((row) => row.operation)).toEqual(['preview', 'publish']);
      expect(writes[1]?.body.confirmation_phrase).toBe(
        'PUBLISH FINAL synthetic confirmed sequence',
      );
    } else {
      await expect(
        application.getByText('Publication is disabled.', { exact: false }),
      ).toBeVisible();
      expect(writes.map((row) => row.operation)).toEqual(['preview']);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
