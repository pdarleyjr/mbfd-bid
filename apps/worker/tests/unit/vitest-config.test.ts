import { afterEach, describe, expect, it, vi } from 'vitest';

const originalArgv = [...process.argv];
const launcherTest = 'tests/integration/a-day-admin-force.test.ts';

async function loadConfig(argv: string[]) {
  vi.resetModules();
  process.argv = argv;
  const { default: config } = await import('../../vitest.config');
  return config;
}

afterEach(() => {
  process.argv = [...originalArgv];
});

describe('Worker Vitest configuration', () => {
  it('excludes local Wrangler launcher tests from deterministic non-watch runs', async () => {
    const config = await loadConfig([...originalArgv, 'run']);

    expect(config.test?.exclude).toContain(launcherTest);
  }, 15_000);

  it('retains launcher-test coverage for the interactive watch command', async () => {
    const config = await loadConfig([...originalArgv]);

    expect(config.test?.exclude).not.toContain(launcherTest);
  });
});
