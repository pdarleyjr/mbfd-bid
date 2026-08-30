import { resolve } from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Dedicated Workers-runtime project for eviction evidence. The ordinary suite
 * keeps its existing Node and local-Wrangler projects; this project is the
 * only one that needs a real DO binding and cloudflare:test lifecycle APIs.
 */
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(resolve(import.meta.dirname, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.do-eviction.toml' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      };
    }),
  ],
  test: {
    include: ['tests/runtime/**/*.test.ts'],
    setupFiles: ['tests/runtime/apply-d1-migrations.ts'],
  },
});
