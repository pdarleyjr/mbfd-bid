/**
 * Plan 06 Task 17 E2E: dissent badge appears on audit-log entries whose
 * ai_advisory shows force_recommended=false.
 *
 * Skipped until the Playwright fixtures harness ships (Plan 09 hardening).
 * The component is exercised by snapshot in unit tests; the marker DOM
 * shape is asserted in apps/worker/tests/ai/dissent.test.ts indirectly.
 *
 * To activate: implement loginAsAdmin helper and remove `.skip`.
 */
import { test } from '@playwright/test';

test.skip('dissent badge appears on audit-log entries with ai_advisory force_recommended=false', async () => {
  // 1. Mock /api/admin/audit with one row whose action='dissent' and
  //    ai_advisory_id='prev1'
  // 2. loginAsAdmin(page)
  // 3. Navigate to /admin/audit
  // 4. Assert [data-testid="audit-dissent-marker-prev1"] is visible
});
