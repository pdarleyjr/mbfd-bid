// Plan 09 Task 6 — D1 backup/restore script regression test.
//
// The scripts shell out to `wrangler d1 export` / `wrangler r2 object put` /
// `wrangler d1 execute`, so the test verifies the FORMAT of the script
// invocation rather than the live wrangler call (Phase A forbids touching
// prod). We assert:
//
//   1. The backup script file exists and uses safe parameter bindings
//      (`-Env`, `-DbName`, `-BucketName`).
//   2. The R2 key it produces follows the `d1/<YYYY-MM-DD>/<dbname>-<HHMM>.sql`
//      schema documented in Plan 09 § D4.
//   3. The restore script accepts `-SnapshotKey` and executes against the
//      target database name (no hard-coded prod values).
//
// Running the actual scripts would call `wrangler` against the live API. We
// avoid that by reading the script source and validating shape.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../..');
const BACKUP_SCRIPT = resolve(REPO_ROOT, 'scripts/d1-backup.ps1');
const RESTORE_SCRIPT = resolve(REPO_ROOT, 'scripts/d1-restore.ps1');

describe('D1 backup / restore scripts (Plan 09 T6)', () => {
  it('backup script exists and accepts the documented parameters', () => {
    const src = readFileSync(BACKUP_SCRIPT, 'utf-8');
    expect(src).toContain('[Parameter(Mandatory)][ValidateSet(');
    expect(src).toMatch(/string\]\$Env/);
    expect(src).toMatch(/string\]\$DbName/);
    expect(src).toMatch(/string\]\$BucketName/);
  });

  it('backup script uploads to the `d1/<day>/<dbname>-<HHMM>.sql` key shape', () => {
    const src = readFileSync(BACKUP_SCRIPT, 'utf-8');
    // The key construction must look like: `d1/$day/$DbName-$now.sql`.
    expect(src).toMatch(/"d1\/\$day\/\$DbName-\$now\.sql"/);
  });

  it('backup script calls wrangler d1 export with --remote', () => {
    const src = readFileSync(BACKUP_SCRIPT, 'utf-8');
    expect(src).toContain('wrangler d1 export $DbName');
    expect(src).toContain('--env $Env --remote');
  });

  it('runs Wrangler from the Worker package where the CLI dependency is installed', () => {
    const src = readFileSync(BACKUP_SCRIPT, 'utf-8');
    expect(src.match(/pnpm --dir apps\/worker exec wrangler/g)).toHaveLength(4);
    expect(src).toContain('wrangler d1 time-travel info $DbName --env $Env --json');
    expect(src).toContain('wrangler d1 export $DbName --env $Env --remote --output $file');
    expect(src.match(/pnpm --dir apps\/worker exec wrangler r2 object put/g)).toHaveLength(2);
    expect(src).not.toContain('& pnpm exec wrangler');
  });

  it('backup script aborts if the dump is < 1KB (sanity guard)', () => {
    const src = readFileSync(BACKUP_SCRIPT, 'utf-8');
    expect(src).toContain('-lt 1024');
    expect(src).toContain('suspiciously small');
  });

  it('restore script exists and accepts -SnapshotKey', () => {
    const src = readFileSync(RESTORE_SCRIPT, 'utf-8');
    expect(src).toMatch(/string\]\$SnapshotKey/);
  });

  it('restore script downloads from R2 and applies via wrangler d1 execute', () => {
    const src = readFileSync(RESTORE_SCRIPT, 'utf-8');
    expect(src).toContain('wrangler r2 object get');
    expect(src).toContain('wrangler d1 execute $DbName');
    expect(src).toContain('--env $Env --remote --file=');
  });

  it('restore script does not hard-code prod database names', () => {
    const src = readFileSync(RESTORE_SCRIPT, 'utf-8');
    // No hard-coded "mbfd-bid-production" anywhere — must take the name as a param.
    const lines = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('#') && !l.includes('Example'));
    expect(lines.join('\n')).not.toContain('mbfd-bid-production');
  });
});
