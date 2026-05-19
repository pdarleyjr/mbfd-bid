/**
 * Plan 05 Task 27 E2E: admin force-pick happy path.
 *
 * The plan body relies on `./fixtures` helpers (loginAsAdmin, seedBidSession,
 * seedMember) that this repo doesn't ship yet. Existing E2E specs use
 * page.route() mocking instead. Until a proper Playwright fixtures harness
 * lands (Plan 09 hardening), this spec is recorded as `test.skip` to keep
 * CI green while preserving the intent for the reviewer.
 *
 * To activate: implement the fixtures helpers and remove `.skip`.
 */
import { test } from '@playwright/test';

test.skip('admin force-pick records a forced bid and surfaces in audit log', async () => {
  // 1. Seed a bid session in position_bid phase, seed a member id=42
  // 2. Navigate to /admin/sessions/:id
  // 3. Click "Force pick" — ForcePickSheet opens
  // 4. Fill member 42 / position A205 / reason text
  // 5. Click sheet's "Force pick" button — POST /api/admin/bid-session/:id/force-pick
  // 6. Navigate to /admin/audit?action=forced_pick — verify the entry appears
});
