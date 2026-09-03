import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localWorkerUrl = 'http://127.0.0.1:31987';
const workerBase = process.env.E2E_TEST_API_BASE ?? localWorkerUrl;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: path.resolve(__dirname, './tests/e2e/global-setup.ts'),
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      // Use plain `next dev` (no Turbopack) because Turbopack rejects
      // `experimental.typedRoutes` in next.config.mjs.
      command: 'pnpm exec next dev --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ENV: 'staging',
        // An explicit controlled API wins. Otherwise browser tests use only
        // the loopback annual mock below and never fall back to shared staging.
        NEXT_PUBLIC_WORKER_BASE: workerBase,
      } as Record<string, string>,
    },
    ...(process.env.E2E_TEST_API_BASE
      ? []
      : [
          {
            command: 'node ./tests/e2e/annual-local-worker.mjs',
            url: `${localWorkerUrl}/health`,
            reuseExistingServer: false,
            timeout: 30_000,
          },
        ]),
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
