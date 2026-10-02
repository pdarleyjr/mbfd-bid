import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(appRoot, '../..');

function readAppFile(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('OpenNext deployment configuration', () => {
  it('uses the supported OpenNext runtime and removes the retired Pages adapter', () => {
    const packageJson = JSON.parse(readAppFile('package.json')) as {
      dependencies: Record<string, string | undefined>;
      devDependencies: Record<string, string | undefined>;
      scripts: Record<string, string | undefined>;
    };

    expect(packageJson.dependencies.next).toBe('15.5.24');
    expect(packageJson.devDependencies['@opennextjs/cloudflare']).toBe('1.20.4');
    expect(packageJson.devDependencies['@cloudflare/next-on-pages']).toBeUndefined();
    expect(packageJson.devDependencies.vercel).toBeUndefined();
    // rpc-client imports the Worker AppType, whose public type graph exposes
    // D1 and Durable Object globals. This type-only dependency is unrelated
    // to the retired Pages adapter.
    expect(packageJson.devDependencies['@cloudflare/workers-types']).toBe('5.20260826.1');
    expect(packageJson.scripts['build:pages']).toBeUndefined();
    expect(packageJson.scripts.prebuild).toBe(
      'pnpm -r --filter @mbfd/shared --filter @mbfd/eligibility --filter @mbfd/a-day run build',
    );
    expect(packageJson.scripts.predev).toBe(
      'pnpm -r --filter @mbfd/shared --filter @mbfd/eligibility --filter @mbfd/a-day run build',
    );
    expect(packageJson.scripts['build:opennext:staging']).toBeUndefined();
    expect(packageJson.scripts['preview:opennext:staging']).toBeUndefined();
    expect(packageJson.scripts['deploy:staging']).toBeUndefined();
    expect(packageJson.scripts['build:opennext:production']).toBe(
      'node --env-file=.env.production ./node_modules/@opennextjs/cloudflare/dist/cli/index.js build --env production',
    );
    expect(packageJson.scripts['preview:opennext:production']).toBe(
      'pnpm build:opennext:production && node --env-file=.env.production ./node_modules/@opennextjs/cloudflare/dist/cli/index.js preview --env production',
    );
    expect(packageJson.scripts['deploy:production']).toBe(
      'pnpm build:opennext:production && node --env-file=.env.production ./node_modules/@opennextjs/cloudflare/dist/cli/index.js deploy --env production',
    );
  });

  it('keeps only the explicit production API and custom-domain target', () => {
    const wrangler = JSON.parse(readAppFile('wrangler.jsonc')) as {
      main?: string;
      workers_dev?: boolean;
      assets?: { directory?: string; binding?: string };
      compatibility_flags?: string[];
      env?: Record<
        string,
        {
          name?: string;
          routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
          vars?: Record<string, string>;
        }
      >;
    };
    const production = wrangler.env?.production;

    expect(wrangler.main).toBe('.open-next/worker.js');
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.assets).toEqual({ directory: '.open-next/assets', binding: 'ASSETS' });
    expect(wrangler.compatibility_flags).toContain('nodejs_compat');
    expect(wrangler.env?.staging).toBeUndefined();
    expect(existsSync(join(appRoot, '.env.staging'))).toBe(false);
    expect(production).toMatchObject({ name: 'mbfd-bid-web-production-opennext' });
    expect(production?.routes).toEqual([{ pattern: 'bid.mbfdhub.com', custom_domain: true }]);
    expect(production?.vars).toMatchObject({
      ENV: 'production',
      WORKER_URL: 'https://api.bid.mbfdhub.com',
      WORKER_BASE_URL: 'https://api.bid.mbfdhub.com',
    });
    expect(readAppFile('.env.production')).toBe(
      'NEXT_PUBLIC_WORKER_BASE=https://api.bid.mbfdhub.com\n',
    );
  });

  it('fails closed when an API target is absent and does not retain Edge runtime declarations', () => {
    const nextConfig = readAppFile('next.config.mjs');
    const cfEnv = readAppFile('lib/cf-env.ts');
    const workerBase = readAppFile('lib/worker-base.ts');
    const rootLayout = readAppFile('app/layout.tsx');
    const headers = readAppFile('public/_headers');

    expect(existsSync(join(appRoot, 'open-next.config.ts'))).toBe(true);
    expect(nextConfig).toContain('initOpenNextCloudflareForDev');
    expect(cfEnv).toContain('getCloudflareContext');
    expect(workerBase).toContain("throw new Error('worker_base_missing')");
    expect(workerBase).not.toContain("'https://api.bid.test.invalid'");
    expect(rootLayout).not.toContain('StagingBanner');
    expect(headers).toContain('/_next/static/*');
    expect(headers).toContain('Cache-Control: public,max-age=31536000,immutable');
    expect(headers).not.toContain('staging.bid.mbfdhub.com');
    expect(headers).toContain('https://api.bid.mbfdhub.com');
    expect(headers).toContain('wss://api.bid.mbfdhub.com');

    const edgeRuntimeFiles = sourceFiles(join(appRoot, 'app')).filter((filePath) =>
      readFileSync(filePath, 'utf8').includes("export const runtime = 'edge'"),
    );
    expect(edgeRuntimeFiles).toEqual([]);
  });

  it('keeps the print-token roster renderer outside the authenticated admin layout', () => {
    const publicRenderPath = join(
      appRoot,
      'app/exports/render/roster/[shift]/[session_id]/page.tsx',
    );
    const oldAdminRenderPath = join(
      appRoot,
      'app/admin/exports/render/roster/[shift]/[session_id]/page.tsx',
    );

    expect(existsSync(publicRenderPath)).toBe(true);
    expect(existsSync(oldAdminRenderPath)).toBe(false);

    const source = readFileSync(publicRenderPath, 'utf8');
    expect(source).toContain('data-roster-export="ready"');
    expect(source).not.toContain('import { verifyPrintToken }');
    expect(source).toContain('/api/admin/exports/roster-data');
  });

  it('has CI build the production artifact and a manual-only production release without a Pages path', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');
    const playwright = readAppFile('playwright.config.ts');
    const deployProduction = readRepoFile('.github/workflows/deploy-production.yml');
    const workerPackageJson = JSON.parse(readRepoFile('apps/worker/package.json')) as {
      scripts: Record<string, string | undefined>;
    };

    expect(ci).toContain('Build OpenNext production artifact (non-deploy)');
    expect(ci).toContain('pnpm build:opennext:production');
    expect(ci).toContain("E2E_USE_BUILT_WEB: '1'");
    expect(ci).toContain('NEXT_PUBLIC_WORKER_BASE: http://127.0.0.1:31987');
    expect(ci).toContain('Build production-mode web artifact for browser tests');
    expect(ci).toContain('pnpm --filter @mbfd/web build');
    expect(ci).toContain('apps/web/test-results');
    expect(playwright).toContain('process.env.CI ? { workers: 2 }');
    expect(existsSync(join(repoRoot, '.github/workflows/deploy-staging.yml'))).toBe(false);
    expect(workerPackageJson.scripts['db:seed:remote']).toBeUndefined();
    expect(deployProduction).toContain('workflow_dispatch:');
    expect(deployProduction).not.toContain('\n  push:');
    expect(deployProduction).not.toContain('\n  pull_request:');
    expect(deployProduction).toContain('environment:\n      name: production');
    expect(deployProduction).toContain('inputs.release_sha');
    expect(deployProduction).toContain('node scripts/assert-production-d1-migration-guard.mjs');
    expect(deployProduction).toContain('pnpm deploy:production');
    expect(deployProduction).toContain('wrangler deploy --env production');
    expect(deployProduction).not.toContain('Cloudflare Pages');
    expect(deployProduction).not.toContain('next-on-pages');
    expect(deployProduction).not.toContain('--commit-dirty');
    expect(deployProduction).not.toContain('db:seed:remote');
  });
});
