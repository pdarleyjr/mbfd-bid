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

  it('binds only explicit staging R2 buckets and names the exports bucket consistently', () => {
    const config = stagingBlock(readWorkerConfig());

    expect(config).toContain('bucket_name = "mbfd-bid-audit-staging-v2"');
    expect(config).toContain('bucket_name = "mbfd-bid-exports-staging-v2"');
    expect(config).toContain('R2_EXPORTS_BUCKET_NAME = "mbfd-bid-exports-staging-v2"');
    expect(config).not.toContain('bucket_name = "mbfd-bid-audit"');
    expect(config).not.toContain('bucket_name = "mbfd-bid-exports"');
    expect(config).not.toContain('R2_EXPORTS_BUCKET_NAME = "mbfd-bid-exports-staging"');
  });

  it('runs non-deploy validation before the controlled D1 guard and deployment', () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, '.github', 'workflows', 'deploy-staging.yml'),
      'utf8',
    );
    const validationStart = workflow.indexOf('  validate-artifacts:');
    const workerDeployStart = workflow.indexOf('  deploy-worker:');
    const guardStart = workflow.indexOf('Require controlled D1 migration gate');

    expect(validationStart).toBeGreaterThanOrEqual(0);
    expect(workerDeployStart).toBeGreaterThan(validationStart);
    expect(guardStart).toBeGreaterThan(workerDeployStart);

    const validation = workflow.slice(validationStart, workerDeployStart);
    expect(validation).toContain('pnpm lint');
    expect(validation).toContain('pnpm typecheck');
    expect(validation).toContain('pnpm -r --filter "./packages/*" build');
    expect(validation).not.toContain('wrangler deploy --env staging --dry-run');
    expect(validation).toContain('pnpm exec wrangler dev --env staging --local');
    expect(validation).toContain('pnpm build:opennext:staging');
    expect(workflow).toContain('node scripts/assert-staging-d1-migration-guard.mjs');
    expect(workflow).not.toMatch(/wrangler\s+d1\s+migrations\s+apply/);
    expect(workflow).not.toContain('db:seed:remote');
  });

  it('makes a clean root typecheck build internal package dependencies first', () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(rootPackage.scripts?.typecheck).toBe(
      'pnpm -r --filter "./packages/*" build && pnpm -r typecheck',
    );
  });
});
