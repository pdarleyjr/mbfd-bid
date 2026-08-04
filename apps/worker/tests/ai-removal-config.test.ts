import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupTestD1, teardownTestD1 } from './integration/helpers/test-d1.js';

const workerRoot = resolve(import.meta.dirname, '..');

describe('AI feature retirement configuration', () => {
  it('has no Workers AI binding, dedicated AI KV binding, or per-minute cron', () => {
    const config = readFileSync(resolve(workerRoot, 'wrangler.toml'), 'utf8');
    expect(config).not.toMatch(/^\s*\[env\.(?:staging|production)\.ai\]/m);
    expect(config).not.toContain('binding = "AI_KV"');
    expect(config).not.toContain('*/1 * * * *');
    expect(config).not.toContain('CF_AI_GATEWAY_URL');
  });

  it('removes the obsolete advisory table from a fully migrated database', async () => {
    const harness = await setupTestD1();
    try {
      const { results } = await harness.db.run(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_advisories'",
      );
      expect(results).toEqual([]);
    } finally {
      await teardownTestD1(harness);
    }
  });
});
