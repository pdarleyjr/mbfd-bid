import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupTestD1, teardownTestD1 } from './integration/helpers/test-d1.js';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..', '..');

describe('deterministic advisory configuration', () => {
  it('contains no generative provider, model, gateway, or advisory schedule', () => {
    const config = readFileSync(resolve(workerRoot, 'wrangler.toml'), 'utf8');
    const envTypes = readFileSync(resolve(workerRoot, 'src/types/env.d.ts'), 'utf8');
    const routeTree = readFileSync(resolve(workerRoot, 'src/index.ts'), 'utf8');
    const secretsInventory = readFileSync(
      resolve(repositoryRoot, 'docs/secrets-inventory.md'),
      'utf8',
    );
    expect(config).not.toMatch(/^\s*\[env\.(?:staging|production)\.ai\]/m);
    expect(config).not.toContain('binding = "AI"');
    expect(config).not.toContain('AI_MODEL');
    expect(config).not.toContain('binding = "AI_KV"');
    expect(config).not.toContain('*/1 * * * *');
    expect(config).not.toContain('CF_AI_GATEWAY_URL');
    expect(config).not.toMatch(/ollama|mbfd-bid-analysis|inference/i);
    expect(envTypes).not.toMatch(/AI_MODEL|\bAI\?:|Workers AI/i);
    expect(routeTree).not.toMatch(/ai-assist|adminAiAssist/i);
    expect(secretsInventory).not.toMatch(/ANTHROPIC_API_KEY|AI Gateway/i);
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
