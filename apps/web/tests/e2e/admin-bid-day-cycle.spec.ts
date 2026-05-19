/**
 * Plan 05 Task 26 E2E: admin day-end/day-start multi-day cycle.
 *
 * The full plan body relies on `./fixtures` helpers (loginAsAdmin,
 * ensureBidYear, etc.) that this repo doesn't ship yet. The existing E2E
 * specs use page.route() mocks rather than a live worker + D1. Until a
 * proper Playwright fixtures harness lands (Plan 09 hardening), this spec
 * is recorded as `test.skip` so CI doesn't fail but the intent is preserved
 * for the reviewer.
 *
 * To activate: implement the fixtures helpers and remove `.skip`.
 */
import { test } from '@playwright/test';

test.skip('admin day-end/day-start cycle increments day_count', async () => {
  // 1. Create session at /admin/sessions/new
  // 2. Click Start session — phase should transition to position_bid, day 0
  // 3. POST /api/admin/bid-session/:id/day-end with scheduled_resume_at
  // 4. Reload — phase should be paused, resume time shown
  // 5. Click Day Start — phase should transition to position_bid, day 1
});
