import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..', '..');
const read = (name: string) => readFileSync(resolve(repositoryRoot, name), 'utf8');

describe('production deployment and isolated test configuration', () => {
  it('has no retired deployment environment or active deployment workflow', () => {
    expect(read('apps/worker/wrangler.toml')).not.toContain('[env.staging');
    expect(existsSync(resolve(repositoryRoot, '.github/workflows/deploy-staging.yml'))).toBe(false);
    const scripts = JSON.parse(read('apps/worker/package.json')).scripts as Record<string, string>;
    expect(scripts['deploy:staging']).toBeUndefined();
    expect(scripts['db:seed:remote']).toBeUndefined();
    expect(scripts['db:migrate:remote']).toBeUndefined();
    expect(scripts.dev).toContain('--config wrangler.test.toml --local --ip 127.0.0.1');
  });

  it('uses fake resource identifiers and a reserved Hub origin for local tests', () => {
    const config = read('apps/worker/wrangler.test.toml');
    expect(config).toContain('ENV = "test"');
    expect(config).toContain('PORTAL_BASE_URL = "https://test.invalid"');
    expect(config).toContain('database_id = "00000000-0000-0000-0000-000000000001"');
    expect(config).not.toMatch(/custom_domain|routes\s*=|queues\.|\[triggers\]/);
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('wrangler dev --config wrangler.test.toml --local --ip 127.0.0.1');
    expect(ci).toContain('pnpm build:opennext:production');
    expect(ci).toContain('node scripts/test-staging-retirement.mjs');
    expect(ci).not.toContain('secrets.CLOUDFLARE');
  });

  it('builds internal package dependencies before a root typecheck', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts.typecheck).toBe('pnpm -r --filter "./packages/*" build && pnpm -r typecheck');
  });

  it('keeps legacy HTTP-shell launchers isolated without pretending to provide D1 identities', () => {
    const config = read('apps/worker/wrangler.launcher-test.toml');
    expect(config).toContain('ENV = "test"');
    expect(config).toContain('workers_dev = false');
    expect(config).toContain('PORTAL_BASE_URL = "https://test.invalid"');
    expect(config).not.toMatch(
      /\[\[d1_databases|kv_namespaces|r2_buckets|queues\.|custom_domain|routes\s*=/,
    );
    for (const file of [
      'a-day-admin-force',
      'a-day-rest',
      'admin-bid',
      'bid-session-recovery',
      'bid-session-routes',
    ]) {
      expect(read(`apps/worker/tests/integration/${file}.test.ts`)).toContain(
        "config: 'wrangler.launcher-test.toml'",
      );
    }
  });

  it('preserves production writeback disabled and manual release with D1 and Worker health gates', () => {
    const source = read('apps/worker/wrangler.toml');
    const config = source.slice(source.indexOf('[env.production]'));
    const workflow = read('.github/workflows/deploy-production.yml');
    expect(config).toContain('PORTAL_BASE_URL = "https://www.mbfdhub.com"');
    expect(config).toContain('WEB_BASE_URL = "https://bid.mbfdhub.com"');
    expect(config).toContain('PORTAL_WRITEBACK_ENABLED = "false"');
    expect(config).toContain('[[env.production.queues.producers]]');
    expect(config).toContain('[[env.production.queues.consumers]]');
    expect(config).toContain('binding = "PORTAL_QUEUE"');
    expect(config).toContain('queue = "mbfd-bid-portal-writeback-production"');
    expect(config).toContain('dead_letter_queue = "mbfd-bid-portal-writeback-production-dlq"');
    expect(config).toContain(
      'PORTAL_WRITEBACK_BASE_URL = "https://portal-writeback-disabled.invalid"',
    );
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\n\s+push:|\n\s+pull_request:/);
    expect(workflow).toContain('node scripts/assert-production-d1-migration-guard.mjs');
    expect(workflow).toContain('pnpm --dir apps/worker exec wrangler deploy --env production');
    const workerDeploy = workflow.slice(
      workflow.indexOf('  deploy-worker:'),
      workflow.indexOf('  deploy-web:'),
    );
    expect(workerDeploy.indexOf('pnpm -r --filter "./packages/*" build')).toBeLessThan(
      workerDeploy.indexOf('node scripts/assert-production-d1-migration-guard.mjs'),
    );
    expect(workerDeploy.indexOf('assert-production-worker-health.mjs')).toBeGreaterThan(
      workerDeploy.indexOf('wrangler deploy --env production'),
    );
    expect(workflow).not.toMatch(/wrangler\s+d1\s+migrations\s+apply/);
    expect(workflow).not.toContain('db:seed:remote');
  });
});
