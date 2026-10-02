import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8').replaceAll('\r\n', '\n');
for (const retired of [
  '.github/workflows/deploy-staging.yml',
  'apps/web/.env.staging',
  'scripts/assert-staging-d1-migration-guard.mjs',
  'scripts/rotate-staging-jwt-pair.sh',
  'apps/worker/scripts/production-baseline-bootstrap.ts',
])
  assert.equal(
    existsSync(join(root, retired)),
    false,
    `Retired activation path remains: ${retired}`,
  );

const worker = read('apps/worker/wrangler.toml');
const production = worker.match(/\[env\.production\][\s\S]*?(?=\n\[triggers\])/)?.[0];
assert.ok(production, 'Production configuration is missing');
assert.equal(
  createHash('sha256').update(production).digest('hex'),
  'cce0a7cc357450c43cd83023ed47fb0ad538c4b4cb9910b96f58c7ce54931b96',
  'Retirement changed the exact production Worker configuration from bbe99aed',
);
assert.doesNotMatch(worker, /\[env\.staging/);
const web = JSON.parse(read('apps/web/wrangler.jsonc'));
assert.deepEqual(Object.keys(web.env), ['production']);
assert.deepEqual(web.env.production, {
  name: 'mbfd-bid-web-production-opennext',
  routes: [{ pattern: 'bid.mbfdhub.com', custom_domain: true }],
  vars: {
    ENV: 'production',
    WORKER_URL: 'https://api.bid.mbfdhub.com',
    WORKER_BASE_URL: 'https://api.bid.mbfdhub.com',
  },
});
assert.equal(web.name, 'mbfd-bid-web-unconfigured', 'Omitting --env must not select production');

const isolated = read('apps/worker/wrangler.test.toml');
assert.match(isolated, /ENV = "test"/);
assert.match(isolated, /PORTAL_BASE_URL = "https:\/\/test\.invalid"/);
assert.match(isolated, /database_id = "00000000-0000-0000-0000-000000000001"/);
assert.doesNotMatch(isolated, /routes\s*=|custom_domain|\[triggers\]|queues\./);
for (const value of [
  'df132142-f00a-45a5-b981-68a94861473f',
  'ba5cd8a0c10d4cae9bb968272f0879cf',
  '6dd16e65-5cb6-4c19-aff2-ec2706e72d50',
  'ce8afe4605464683a51bf6ae9c042c01',
])
  assert.equal(
    isolated.includes(value),
    false,
    'Local tests retain a deployed resource identifier',
  );

for (const name of ['package.json', 'apps/web/package.json', 'apps/worker/package.json']) {
  const scripts = JSON.parse(read(name)).scripts;
  for (const [key, value] of Object.entries(scripts))
    assert.equal(
      /staging|--remote/.test(key + value),
      false,
      `Unreviewed remote/retired package command remains: ${key}`,
    );
}
const backup = read('.github/workflows/d1-backup.yml');
assert.match(backup, /workflow_dispatch:/);
assert.doesNotMatch(backup, /schedule:|\n\s+push:|\n\s+pull_request:|staging/);
assert.match(
  backup,
  /-Env production -DbName mbfd-bid-production -BucketName mbfd-bid-prod-backups/,
);
const ci = read('.github/workflows/ci.yml');
assert.match(ci, /pnpm build:opennext:production/);
assert.match(ci, /wrangler dev --config wrangler\.test\.toml --local --ip 127\.0\.0\.1/);
assert.doesNotMatch(ci, /wrangler deploy|secrets\.CLOUDFLARE|build:opennext:staging/);
assert.equal(ci.includes('staging.bid'), false, 'CI retains a retired network target');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = join(directory, entry.name);
    return entry.isDirectory()
      ? files(location)
      : /\.(?:ts|tsx)$/.test(entry.name)
        ? [location]
        : [];
  });
}
for (const directory of ['apps/worker/src', 'apps/web/app', 'apps/web/lib']) {
  for (const location of files(join(root, directory))) {
    const source = readFileSync(location, 'utf8');
    for (const retiredHost of ['staging.bid.mbfdhub.com', 'staging.mbfdhub.com'])
      assert.equal(
        source.includes(retiredHost),
        false,
        `Retired network target remains: ${location}`,
      );
  }
}
process.stdout.write(
  'PASS: retired activation/network targets removed; production configuration identical; tests isolated; production backup remains manual.\n',
);
