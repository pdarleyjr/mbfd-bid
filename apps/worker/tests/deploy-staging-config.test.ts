import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..', '..');

function readWorkerConfig(): string {
  return readFileSync(resolve(workerRoot, 'wrangler.toml'), 'utf8');
}

function stagingBlock(config: string): string {
  return config.slice(config.indexOf('[env.staging]'), config.indexOf('[env.production]'));
}

describe('staging release configuration', () => {
  it('keeps the staging queue producer but has no portal-writeback consumer', () => {
    const config = stagingBlock(readWorkerConfig());

    expect(config).toContain('[[env.staging.queues.producers]]');
    expect(config).toContain('queue = "mbfd-portal-writebacks-staging"');
    expect(config).not.toContain('[[env.staging.queues.consumers]]');
  });

  it('validates both deployable artifacts before a staging migration or deployment', () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, '.github', 'workflows', 'deploy-staging.yml'),
      'utf8',
    );
    const validationStart = workflow.indexOf('  validate-artifacts:');
    const workerDeployStart = workflow.indexOf('  deploy-worker:');
    const migrationStart = workflow.indexOf('Apply D1 migrations (staging, remote)');

    expect(validationStart).toBeGreaterThanOrEqual(0);
    expect(workerDeployStart).toBeGreaterThan(validationStart);
    expect(migrationStart).toBeGreaterThan(workerDeployStart);

    const validation = workflow.slice(validationStart, workerDeployStart);
    expect(validation).toContain('pnpm lint');
    expect(validation).toContain('pnpm typecheck');
    expect(validation).toContain('pnpm -r --filter "./packages/*" build');
    expect(validation).toContain('wrangler deploy --env staging --dry-run');
    expect(validation).toContain('pnpm build:opennext:staging');
    expect(workflow).not.toContain('db:seed:remote');
  });
});
