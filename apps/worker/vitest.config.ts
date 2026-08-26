import { configDefaults, defineConfig } from 'vitest/config';

// These tests launch a real local Wrangler process. They run in a dedicated
// serial command below so the rest of the suite retains its normal parallelism.
const wranglerLauncherTests = [
  'tests/integration/a-day-admin-force.test.ts',
  'tests/integration/a-day-rest.test.ts',
  'tests/integration/admin-bid.test.ts',
  'tests/integration/bid-session-recovery.test.ts',
  'tests/integration/bid-session-routes.test.ts',
];

// Keep `vitest` watch mode compatible with its historical full-suite behavior.
// The deterministic `vitest run` command delegates these process-launching
// files to the serial launcher configuration below.
const isNonWatchRun = process.argv.includes('run') || process.argv.includes('--run');

export default defineConfig({
  test: {
    exclude: isNonWatchRun ? [...configDefaults.exclude, ...wranglerLauncherTests] : configDefaults.exclude,
  },
});
