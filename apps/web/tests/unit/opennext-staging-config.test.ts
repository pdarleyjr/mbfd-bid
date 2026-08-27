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

describe('staging OpenNext configuration', () => {
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
    expect(packageJson.scripts['deploy:production']).toBeUndefined();
    expect(packageJson.scripts.prebuild).toBe('pnpm -r --filter "./packages/*" build');
    expect(packageJson.scripts.predev).toBe('pnpm -r --filter "./packages/*" build');
    expect(packageJson.scripts['build:opennext:staging']).toBe(
      'node --env-file=.env.staging ./node_modules/@opennextjs/cloudflare/dist/cli/index.js build --env staging',
    );
    expect(packageJson.scripts['preview:opennext:staging']).toBe(
      'pnpm build:opennext:staging && node --env-file=.env.staging ./node_modules/@opennextjs/cloudflare/dist/cli/index.js preview --env staging',
    );
    expect(packageJson.scripts['deploy:staging']).toBe(
      'pnpm build:opennext:staging && node --env-file=.env.staging ./node_modules/@opennextjs/cloudflare/dist/cli/index.js deploy --env staging',
    );
  });

  it('is explicitly bound to the staging API and staging hostname only', () => {
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
    const staging = wrangler.env?.staging;

    expect(wrangler.main).toBe('.open-next/worker.js');
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.assets).toEqual({ directory: '.open-next/assets', binding: 'ASSETS' });
    expect(wrangler.compatibility_flags).toContain('nodejs_compat');
    expect(staging).toMatchObject({ name: 'mbfd-bid-web-staging-opennext' });
    expect(staging?.routes).toEqual([{ pattern: 'staging.bid.mbfdhub.com', custom_domain: true }]);
    expect(staging?.vars).toMatchObject({
      ENV: 'staging',
      WORKER_URL: 'https://api.staging.bid.mbfdhub.com',
      WORKER_BASE_URL: 'https://api.staging.bid.mbfdhub.com',
    });
    expect(readAppFile('.env.staging')).toBe(
      'NEXT_PUBLIC_WORKER_BASE=https://api.staging.bid.mbfdhub.com\n',
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
    expect(workerBase).not.toContain("'https://api.staging.bid.mbfdhub.com'");
    expect(rootLayout).toContain('StagingBanner');
    expect(rootLayout).toContain("cfEnv('ENV')");
    expect(headers).toContain('/_next/static/*');
    expect(headers).toContain('Cache-Control: public,max-age=31536000,immutable');
    expect(headers).toContain('https://api.staging.bid.mbfdhub.com');
    expect(headers).toContain('wss://api.staging.bid.mbfdhub.com');
    expect(headers).not.toContain('https://api.bid.mbfdhub.com');
    expect(headers).not.toContain('wss://api.bid.mbfdhub.com');

    const edgeRuntimeFiles = sourceFiles(join(appRoot, 'app')).filter((filePath) =>
      readFileSync(filePath, 'utf8').includes("export const runtime = 'edge'"),
    );
    expect(edgeRuntimeFiles).toEqual([]);
  });

  it('has CI build the OpenNext artifact while staging deployment contains no Pages path', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');
    const deployStaging = readRepoFile('.github/workflows/deploy-staging.yml');
    const workerPackageJson = JSON.parse(readRepoFile('apps/worker/package.json')) as {
      scripts: Record<string, string | undefined>;
    };

    expect(ci).toContain('Build OpenNext staging artifact (non-deploy)');
    expect(ci).toContain('pnpm build:opennext:staging');
    expect(deployStaging).toContain('Deploy web (OpenNext Worker, staging)');
    expect(deployStaging).toContain('Build and deploy OpenNext Worker (staging only)');
    expect(deployStaging).toContain('pnpm deploy:staging');
    expect(deployStaging).not.toContain('Cloudflare Pages');
    expect(deployStaging).not.toContain('next-on-pages');
    expect(deployStaging).not.toContain('--commit-dirty');
    expect(deployStaging).toContain(
      'pnpm exec wrangler d1 migrations apply mbfd-bid-staging --remote --env staging',
    );
    expect(deployStaging).not.toContain('pnpm db:seed:remote');
    expect(workerPackageJson.scripts['db:seed:remote']).toBe('tsx seed/2026.ts --remote');
  });
});
