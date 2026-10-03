import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

const MIGRATION = '0071_bid_evidence_reviewed_updates.sql';
const DATABASE = 'mbfd-bid-production';
const DATABASE_ID = 'df132142-f00a-45a5-b981-68a94861473f';
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const REQUIRED_TABLES = [
  'bid_evidence_freezes',
  'bid_definition_versions',
  'bid_definition_heads',
  'bid_sessions',
  'bid_session_policy_snapshots',
  'canonical_bid_session_state',
  'bid_order',
  'bids',
  'bid_command_receipts',
  'bid_command_events',
  'bid_audit_outbox',
  'audit_log',
  'admin_configuration_receipts',
  'members',
  'member_credentials',
  'member_qualification_events',
  'personnel_lifecycle_events',
  'member_assignments',
  'credentials',
  'credential_catalog_metadata',
  'member_service_evidence',
  'member_bid_tour_evidence',
  'staffing_positions',
  'staffing_tenure_evidence',
  'assignment_imports',
  'assignment_import_rows',
  'assignment_observations',
  'assignment_import_missing_observations',
  'bid_year_staffing_baselines',
  'bid_ordinal_datasets',
  'targetsolutions_imports',
  'targetsolutions_rows',
  'targetsolutions_mappings',
  'targetsolutions_commands',
  'targetsolutions_mapping_history',
  'portal_writeback_queue',
];
const fail = (condition, message) => {
  if (!condition) throw new Error(message);
};
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;
export const migrationWitnessHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
const same = (left, right) => migrationWitnessHash(left) === migrationWitnessHash(right);

/** Read-only streaming artifact verification, with hashes for compressed and
 * original bytes. Never imports SQL or opens a database. */
export async function verifyBackupArtifact(path, recovery) {
  fail(
    recovery.schema_version === 1 || recovery.schema_version === 2,
    'Unsupported recovery receipt',
  );
  fail(
    Number.isSafeInteger(recovery.backup_bytes) &&
      recovery.backup_bytes >= 1024 &&
      HASH.test(recovery.backup_sha256),
    'Invalid original SQL receipt',
  );
  const gzip = recovery.schema_version === 2;
  fail(
    typeof recovery.backup_key === 'string' &&
      recovery.backup_key.endsWith(gzip ? '.sql.gz' : '.sql'),
    'Backup key/encoding mismatch',
  );
  const digest = async (stream, maximumBytes) => {
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += chunk.length;
        fail(bytes <= maximumBytes, 'Backup exceeds its verified receipt size');
        hash.update(chunk);
      }
    } finally {
      stream.destroy();
    }
    return { bytes, sha256: hash.digest('hex') };
  };
  let transport = null;
  if (gzip) {
    fail(
      recovery.transport_encoding === 'gzip' &&
        Number.isSafeInteger(recovery.transport_bytes) &&
        recovery.transport_bytes > 0 &&
        recovery.transport_bytes <= 314572800 &&
        HASH.test(recovery.transport_sha256),
      'Invalid gzip transport receipt',
    );
    transport = await digest(createReadStream(path), recovery.transport_bytes);
    fail(
      transport.bytes === recovery.transport_bytes &&
        transport.sha256 === recovery.transport_sha256,
      'Compressed transport integrity failed',
    );
  } else {
    fail(
      recovery.transport_encoding === undefined &&
        recovery.transport_sha256 === undefined &&
        recovery.transport_bytes === undefined,
      'Legacy SQL receipt transport is ambiguous',
    );
  }
  const source = createReadStream(path);
  let decoded = source;
  if (gzip) {
    decoded = createGunzip();
    source.on('error', (error) => decoded.destroy(error));
    source.pipe(decoded);
  }
  let raw;
  try {
    raw = await digest(decoded, recovery.backup_bytes);
  } catch {
    throw new Error('Original SQL decoding/integrity failed');
  } finally {
    source.destroy();
  }
  fail(
    raw.bytes === recovery.backup_bytes && raw.sha256 === recovery.backup_sha256,
    'Original SQL integrity failed',
  );
  return {
    backupSha256: raw.sha256,
    backupBytes: raw.bytes,
    ...(transport
      ? { backupTransportSha256: transport.sha256, backupTransportBytes: transport.bytes }
      : {}),
  };
}

/** Pure verifier for this one controlled 70 -> 71 operation. It cannot run SQL,
 * download a backup, migrate D1, deploy, or authorize a production operation. */
export function verifyReviewedUpdateMigration(input, trusted, phase) {
  fail(phase === 'before' || phase === 'after', 'Explicit before/after verification is required');
  fail(
    input.environment === 'production' &&
      input.database === DATABASE &&
      input.databaseId === DATABASE_ID &&
      trusted.databaseId === DATABASE_ID,
    'Production database identity mismatch',
  );
  fail(
    COMMIT.test(input.releaseSha) && input.releaseSha === trusted.releaseSha,
    'Exact release HEAD mismatch',
  );
  fail(
    HASH.test(input.migrationSha256) && input.migrationSha256 === trusted.migrationSha256,
    'Exact 0071 SQL hash mismatch',
  );
  fail(
    typeof input.actorSubject === 'string' && input.actorSubject.trim().length > 0,
    'Verified operator subject is required',
  );
  fail(
    trusted.migrations.length === 71 && trusted.migrations.at(-1) === MIGRATION,
    'Canonical release must end at exactly 0071',
  );
  fail(
    same(input.before.migrations, trusted.migrations.slice(0, -1)) &&
      same(input.pendingMigrations, [MIGRATION]),
    'Only exact pending migration 0071 is permitted',
  );
  const recovery = trusted.recovery;
  fail(
    (recovery.schema_version === 1 || recovery.schema_version === 2) &&
      recovery.environment === 'production' &&
      recovery.database === DATABASE &&
      recovery.source_commit === input.releaseSha,
    'Fresh recovery receipt must bind the actual release',
  );
  fail(
    typeof input.recoveryReceiptKey === 'string' &&
      input.recoveryReceiptKey === `${recovery.backup_key}.recovery.json` &&
      HASH.test(trusted.recoveryReceiptSha256) &&
      HASH.test(recovery.backup_sha256) &&
      recovery.backup_sha256 === trusted.backupSha256 &&
      recovery.backup_bytes === trusted.backupBytes &&
      Number.isSafeInteger(trusted.backupBytes) &&
      trusted.backupBytes >= 1024,
    'Verified private SQL backup and recovery receipt are required',
  );
  if (recovery.schema_version === 2) {
    fail(
      recovery.backup_key.endsWith('.sql.gz') &&
        recovery.transport_encoding === 'gzip' &&
        HASH.test(recovery.transport_sha256) &&
        recovery.transport_sha256 === trusted.backupTransportSha256 &&
        Number.isSafeInteger(recovery.transport_bytes) &&
        recovery.transport_bytes > 0 &&
        recovery.transport_bytes <= 314572800 &&
        recovery.transport_bytes === trusted.backupTransportBytes,
      'Verified compressed backup transport is required',
    );
  } else {
    fail(
      recovery.backup_key.endsWith('.sql') &&
        recovery.transport_encoding === undefined &&
        recovery.transport_sha256 === undefined &&
        recovery.transport_bytes === undefined,
      'Legacy SQL receipt transport is ambiguous',
    );
  }
  fail(
    typeof recovery.time_travel_bookmark === 'string' &&
      /^[0-9a-f]+(?:-[0-9a-f]+)+$/.test(recovery.time_travel_bookmark),
    'Verified Time Travel bookmark is required',
  );
  const startedAt = Date.parse(input.startedAt);
  const bookmarkAt = Date.parse(recovery.bookmark_captured_at);
  fail(
    Number.isFinite(trusted.nowMs) &&
      startedAt <= trusted.nowMs &&
      (phase !== 'before' || trusted.nowMs - startedAt <= 5 * 60 * 1000),
    'Pre-migration verification must be performed at the current operation boundary',
  );
  fail(
    Number.isFinite(startedAt) &&
      Number.isFinite(bookmarkAt) &&
      bookmarkAt <= startedAt &&
      startedAt - bookmarkAt <= 2 * 60 * 60 * 1000,
    'Recovery evidence is stale or from the future',
  );
  const checkWitness = (witness) => {
    fail(
      witness.integrity === 'ok' && witness.foreignKeyViolations === 0,
      'D1 integrity or foreign-key check failed',
    );
    fail(
      REQUIRED_TABLES.every((table) => Object.hasOwn(witness.tables, table)),
      'Protected source/session witness is incomplete',
    );
    for (const entry of Object.values(witness.tables))
      fail(
        entry && Number.isSafeInteger(entry.count) && entry.count >= 0 && HASH.test(entry.sha256),
        'Protected table count/hash is invalid',
      );
  };
  checkWitness(input.before);
  if (phase === 'before')
    return { ok: true, phase, releaseSha: input.releaseSha, migration: MIGRATION };
  checkWitness(input.after);
  fail(
    same(input.after.migrations, trusted.migrations),
    'Post-migration ledger is not exact 1..71',
  );
  fail(
    same(input.before.tables, input.after.tables),
    'Existing source, frozen runs or audit data changed during migration',
  );
  fail(
    input.after.reviewedUpdates === 0 && input.after.reviewedUpdateSourceRevision === 0,
    'Migration must not capture evidence or change a source head/session',
  );
  const appliedAt = Date.parse(input.appliedAt);
  fail(
    Number.isFinite(appliedAt) && appliedAt >= startedAt && appliedAt <= trusted.nowMs,
    'Migration completion instant is invalid',
  );
  return {
    schema_version: 1,
    operation: 'controlled-production-0071',
    environment: 'production',
    database: DATABASE,
    database_id: DATABASE_ID,
    release_sha: input.releaseSha,
    migration: MIGRATION,
    migration_sha256: input.migrationSha256,
    actor_subject: input.actorSubject,
    started_at: input.startedAt,
    applied_at: input.appliedAt,
    before_ledger_sha256: migrationWitnessHash(input.before.migrations),
    after_ledger_sha256: migrationWitnessHash(input.after.migrations),
    preserved_tables_sha256: migrationWitnessHash(input.before.tables),
    recovery_receipt_key: input.recoveryReceiptKey,
    recovery_receipt_sha256: trusted.recoveryReceiptSha256,
    backup_key: recovery.backup_key,
    backup_sha256: recovery.backup_sha256,
    ...(recovery.schema_version === 2
      ? {
          backup_transport_encoding: recovery.transport_encoding,
          backup_transport_sha256: recovery.transport_sha256,
          backup_transport_bytes: recovery.transport_bytes,
        }
      : {}),
    time_travel_bookmark: recovery.time_travel_bookmark,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [phase, inputPath, recoveryPath, backupPath, outputPath] = process.argv.slice(2);
  fail(
    inputPath && recoveryPath && backupPath && outputPath,
    'Usage: verifier before|after private-input.json recovery.json backup.sql[.gz] private-output.json',
  );
  fail(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '',
    'Candidate checkout must be clean',
  );
  const releaseSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const migrationBytes = readFileSync(resolve('apps/worker/migrations', MIGRATION));
  const recoveryBytes = readFileSync(recoveryPath);
  const recovery = JSON.parse(recoveryBytes.toString('utf8'));
  const backup = await verifyBackupArtifact(backupPath, recovery);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const result = verifyReviewedUpdateMigration(
    JSON.parse(readFileSync(inputPath, 'utf8')),
    {
      releaseSha,
      databaseId: DATABASE_ID,
      migrationSha256: hash(migrationBytes),
      nowMs: Date.now(),
      migrations: readdirSync('apps/worker/migrations')
        .filter((name) => /^\d{4}_.+\.sql$/.test(name))
        .sort(),
      recovery,
      recoveryReceiptSha256: hash(recoveryBytes),
      ...backup,
    },
    phase,
  );
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(
    `Reviewed-update migration ${phase} verification PASS; private evidence saved.\n`,
  );
}
