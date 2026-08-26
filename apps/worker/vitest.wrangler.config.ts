import { defineConfig } from 'vitest/config';

const WRANGLER_STARTUP_TIMEOUT_MS = 60_000;

export default defineConfig({
  test: {
    include: [
      'tests/integration/a-day-admin-force.test.ts',
      'tests/integration/a-day-rest.test.ts',
      'tests/integration/admin-bid.test.ts',
      'tests/integration/bid-session-recovery.test.ts',
      'tests/integration/bid-session-routes.test.ts',
    ],
    // Each file starts and stops Wrangler in beforeAll/afterAll. Serializing
    // them avoids concurrent local Wrangler startup pressure and makes
    // transient bundle failures diagnosable without weakening assertions.
    fileParallelism: false,
    // This applies only to lifecycle hooks in this launcher command; individual
    // test assertions keep Vitest's normal timeout and still fail normally.
    hookTimeout: WRANGLER_STARTUP_TIMEOUT_MS,
  },
});
