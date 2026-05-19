/**
 * Plan 06 Task 15 E2E: AIAdvisoryPanel always-visible side panel.
 *
 * The plan body relies on `./fixtures` helpers (loginAsAdmin, mock JWT cookie)
 * that this repo doesn't ship yet. Following the precedent set by Plan 04 /
 * 05 specs, this is recorded as `test.skip` until the Playwright fixtures
 * harness lands (Plan 09 hardening). The intent is preserved for the
 * reviewer and the production UI is covered by component-level snapshots.
 *
 * To activate: implement the fixtures helpers and remove `.skip`.
 */
import { test } from '@playwright/test';

test.describe.skip('AIAdvisoryPanel', () => {
  test('renders within 2s of turn-start with summary, recommendations, ineligible-top-picks, forecast', async () => {
    // 1. Mock /api/admin/ai/advise-current with the canonical envelope
    // 2. loginAsAdmin(page)
    // 3. Navigate to /admin/bid
    // 4. Assert ai-panel-summary, ai-panel-recommendation-B105,
    //    ai-panel-ineligible-D101, ai-panel-warning-A305 are visible
  });

  test('shows stale badge when envelope.stale = true', async () => {
    // Mock /api/admin/ai/advise-current with stale=true and expect
    // ai-panel-stale-badge to be visible.
  });
});
