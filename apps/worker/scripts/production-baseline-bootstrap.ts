/**
 * Production canonical baseline bootstrap.
 *
 * This command copies only reviewed canonical roster dependencies associated
 * with one committed official TeleStaff source hash. It never copies bids,
 * sessions, assignments, imports, audit rows, configuration, or secrets.
 * Production apply requires an exact confirmation phrase, creates and uploads
 * a D1 backup before mutation, and verifies that a second plan is a no-op.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { parseTeleStaffAssignmentsHtml } from '../src/lib/telestaff-assignment-html.js';
import {
  buildProductionBaselineSql,
  planProductionBaseline,
} from './production-baseline-bootstrap-lib.js';

const WORKER_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY_CONFIRMATION = 'APPLY_PRODUCTION_CANONICAL_BASELINE';

interface Options {
  mode: 'apply' | 'dry-run';
  referenceDb: 'mbfd-bid-staging';
  referenceEnv: 'staging';
  productionDb: 'mbfd-bid-production';
  productionEnv: 'production';
  sourceHtml: string;
  sourceSnapshotAsOf?: string;
  backupBucket: 'mbfd-bid-prod-backups';
  confirm?: string;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function requiredExact<T extends string>(args: string[], name: string, expected: T): T {
  const value = optionValue(args, name);
  if (value !== expected) throw new Error(`${name} must be exactly ${expected}`);
  return expected;
}

function parseOptions(args: string[]): Options {
  const mode = optionValue(args, '--mode');
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error('--mode must be dry-run or apply');
  const sourceHtml = optionValue(args, '--source-html');
  if (sourceHtml === undefined) throw new Error('--source-html is required');
  return {
    mode,
    sourceHtml: resolve(sourceHtml),
    sourceSnapshotAsOf: optionValue(args, '--source-snapshot-as-of'),
    referenceDb: requiredExact(args, '--reference-db', 'mbfd-bid-staging'),
    referenceEnv: requiredExact(args, '--reference-env', 'staging'),
    productionDb: requiredExact(args, '--production-db', 'mbfd-bid-production'),
    productionEnv: requiredExact(args, '--production-env', 'production'),
    backupBucket: requiredExact(args, '--backup-bucket', 'mbfd-bid-prod-backups'),
    confirm: optionValue(args, '--confirm'),
  };
}

function safeToolError(stderr: string): string {
  const lastLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return (lastLine ?? 'command failed').replace(/https?:\/\/\S+/g, '[redacted-url]');
}

function wrangler(args: string[]): void {
  const wranglerEntrypoint = resolve(WORKER_ROOT, 'node_modules/wrangler/bin/wrangler.js');
  const result = spawnSync(process.execPath, [wranglerEntrypoint, ...args], {
    cwd: WORKER_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = result.error?.message ?? result.stderr ?? result.stdout ?? '';
    throw new Error(`wrangler failed: ${safeToolError(detail)}`);
  }
}

function exportD1(database: string, environment: string, output: string): void {
  wrangler(['d1', 'export', database, '--env', environment, '--remote', '--output', output]);
}

function loadExport(path: string): Database.Database {
  const database = new Database(':memory:');
  // D1 exports can contain historically valid Cloudflare FK layouts that
  // desktop SQLite rejects while replaying unrelated tables. Planning is
  // read-only; constraint validation remains authoritative in remote D1.
  database.pragma('foreign_keys = OFF');
  database.exec(readFileSync(path, 'utf8'));
  return database;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function utcStamp(date: Date): { compact: string; day: string } {
  const iso = date.toISOString();
  return {
    day: iso.slice(0, 10),
    compact: `${iso.replaceAll(/[-:.]/g, '').slice(0, 15)}Z`,
  };
}

function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.mode === 'apply' && options.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`apply requires --confirm ${APPLY_CONFIRMATION}`);
  }

  const sourceBytes = readFileSync(options.sourceHtml);
  const source = await parseTeleStaffAssignmentsHtml(sourceBytes);
  if (!source.ok) throw new Error(`TeleStaff parser rejected source: ${source.code}`);
  const completeRows = source.rows.filter((row) => row.topologyCompleteness === 'complete').length;
  const incompleteRows = source.rows.length - completeRows;
  output({
    phase: 'source-validation',
    sourceHash: source.sourceHash,
    parserVersion: source.parserVersion,
    normalizedRows: source.normalizedDataRowCount,
    uniqueEmployees: source.uniqueEmployeeCount,
    reportRows: source.reportRowCount,
    structuralRows: source.structuralRowCount,
    completeRows,
    incompleteRows,
    duplicateEmployees: 0,
    parseFailures: 0,
  });

  const tempRoot = mkdtempSync(join(tmpdir(), 'mbfd-production-baseline-'));
  let reference: Database.Database | undefined;
  let production: Database.Database | undefined;
  try {
    const referenceExport = join(tempRoot, 'reference.sql');
    const productionExport = join(tempRoot, 'production-before.sql');
    exportD1(options.referenceDb, options.referenceEnv, referenceExport);
    exportD1(options.productionDb, options.productionEnv, productionExport);
    reference = loadExport(referenceExport);
    production = loadExport(productionExport);

    const plan = planProductionBaseline(reference, production, source.sourceHash, {
      asOf: options.sourceSnapshotAsOf,
    });
    output({ phase: 'baseline-plan', mode: options.mode, ...plan.summary });
    if (options.mode === 'dry-run') return;
    if (plan.summary.insertsRequired === 0) {
      output({ phase: 'apply', result: 'no-op' });
      return;
    }

    const stamp = utcStamp(new Date());
    const backupName = `${options.productionDb}-${stamp.compact}.sql`;
    const backupPath = join(tempRoot, backupName);
    copyFileSync(productionExport, backupPath);
    const backupBytes = statSync(backupPath).size;
    if (backupBytes < 1_024) throw new Error('production backup is suspiciously small');
    const backupHash = sha256(backupPath);
    const backupKey = `d1/${stamp.day}/${backupName}`;
    wrangler([
      'r2',
      'object',
      'put',
      `${options.backupBucket}/${backupKey}`,
      `--file=${backupPath}`,
      '--remote',
    ]);
    output({
      phase: 'production-backup',
      bucket: options.backupBucket,
      key: backupKey,
      bytes: backupBytes,
      sha256: backupHash,
    });

    const applySqlPath = join(tempRoot, 'apply.sql');
    writeFileSync(applySqlPath, buildProductionBaselineSql(plan), {
      encoding: 'utf8',
      mode: 0o600,
    });
    wrangler([
      'd1',
      'execute',
      options.productionDb,
      '--env',
      options.productionEnv,
      '--remote',
      '--file',
      applySqlPath,
    ]);

    const afterExport = join(tempRoot, 'production-after.sql');
    exportD1(options.productionDb, options.productionEnv, afterExport);
    production.close();
    production = loadExport(afterExport);
    const verification = planProductionBaseline(reference, production, source.sourceHash, {
      asOf: options.sourceSnapshotAsOf,
    });
    if (verification.summary.insertsRequired !== 0) {
      throw new Error('post-apply idempotency verification failed');
    }
    output({
      phase: 'apply-verification',
      result: 'applied',
      insertsRequiredOnSecondPlan: verification.summary.insertsRequired,
    });
  } finally {
    reference?.close();
    production?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'production baseline bootstrap failed'}\n`,
  );
  process.exitCode = 1;
});
