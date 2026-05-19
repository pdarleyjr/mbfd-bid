/**
 * Plan 06 Task 16 E2E: AIAskDeepDialog streaming via /advise-deep.
 *
 * Skipped until the Playwright fixtures harness (Plan 09 hardening) ships
 * loginAsAdmin + JWT cookie helpers. Production code is exercised by
 * tests/integration/routes/ai-advise-deep.test.ts (worker) which already
 * verifies the SSE response shape end-to-end.
 *
 * To activate: implement the fixtures helpers and remove `.skip`.
 */
import { test } from '@playwright/test';

test.skip('streams tokens from /advise-deep', async () => {
  // 1. page.route('**/api/admin/ai/advise-deep') -> SSE response with two
  //    text-deltas + event:done
  // 2. loginAsAdmin(page)
  // 3. Navigate to /admin/bid, click [data-testid="ai-ask-deep-trigger"]
  // 4. Fill ai-ask-deep-input, click ai-ask-deep-submit
  // 5. Assert ai-ask-deep-output contains 'Hello admin'
});
