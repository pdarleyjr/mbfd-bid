import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const migrationsDirectory = resolve('apps/worker/migrations');
const expectedMigrations = readdirSync(migrationsDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

if (expectedMigrations.length === 0) {
  throw new Error('No canonical Worker migrations were found. Refusing staging deployment.');
}

const pnpmArgs = [
  '--dir',
  'apps/worker',
  'exec',
  'wrangler',
  'd1',
  'execute',
  'mbfd-bid-staging',
  '--remote',
  '--env',
  'staging',
  '--command',
  'SELECT name FROM d1_migrations ORDER BY id ASC;',
];
const windowsCommand =
  "$ErrorActionPreference = 'Stop'; & pnpm --dir apps/worker exec wrangler d1 execute mbfd-bid-staging --remote --env staging --command 'SELECT name FROM d1_migrations ORDER BY id ASC;'; exit $LASTEXITCODE";
const command = process.platform === 'win32' ? 'pwsh.exe' : 'pnpm';
const commandArgs =
  process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', windowsCommand]
    : pnpmArgs;
const result = spawnSync(command, commandArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(
    result.stderr ||
      result.stdout ||
      result.error?.message ||
      'Could not read the staging D1 migration ledger.\n',
  );
  process.exit(result.status ?? 1);
}

const output = result.stdout ?? '';
const jsonStart = output.indexOf('[');
if (jsonStart === -1) {
  throw new Error('D1 ledger response was not JSON. Refusing staging deployment.');
}

let entries;
try {
  entries = JSON.parse(output.slice(jsonStart));
} catch {
  throw new Error('Could not parse the staging D1 migration ledger. Refusing staging deployment.');
}

const actualMigrations = entries?.[0]?.results?.map((row) => row?.name).filter(Boolean);
if (!Array.isArray(actualMigrations)) {
  throw new Error('D1 ledger response omitted migration names. Refusing staging deployment.');
}

const exactMatch =
  actualMigrations.length === expectedMigrations.length &&
  actualMigrations.every((name, index) => name === expectedMigrations[index]);

if (!exactMatch) {
  const actualLast = actualMigrations.at(-1) ?? 'none';
  const expectedLast = basename(expectedMigrations.at(-1));
  console.error(
    `STAGING_D1_MIGRATION_GUARD_BLOCKED: ledger ends at ${actualLast}; deployment requires the controlled migration gate through ${expectedLast}.`,
  );
  process.exit(1);
}

process.stdout.write(
  `STAGING_D1_MIGRATION_GUARD_PASS: ledger matches ${expectedMigrations.length} canonical migrations.\n`,
);
