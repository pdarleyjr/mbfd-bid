import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  verifyBackupArtifact,
  verifyReviewedUpdateMigration,
} from './verify-reviewed-update-migration.mjs';

const migrations = readdirSync('apps/worker/migrations')
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const required = [
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
const tables = Object.fromEntries(
  required.map((table) => [table, { count: 1, sha256: 'b'.repeat(64) }]),
);
const trusted = {
  releaseSha: 'a'.repeat(40),
  databaseId: 'df132142-f00a-45a5-b981-68a94861473f',
  migrationSha256: 'c'.repeat(64),
  migrations,
  nowMs: Date.parse('2026-10-02T01:10:00Z'),
  recoveryReceiptSha256: 'd'.repeat(64),
  backupSha256: 'e'.repeat(64),
  backupBytes: 2048,
  recovery: {
    schema_version: 1,
    environment: 'production',
    database: 'mbfd-bid-production',
    source_commit: 'a'.repeat(40),
    backup_key: 'd1/synthetic.sql',
    backup_sha256: 'e'.repeat(64),
    backup_bytes: 2048,
    time_travel_bookmark: 'aaaa-bbbb',
    bookmark_captured_at: '2026-10-02T01:00:00Z',
  },
};
const input = {
  environment: 'production',
  database: 'mbfd-bid-production',
  databaseId: trusted.databaseId,
  releaseSha: trusted.releaseSha,
  migrationSha256: trusted.migrationSha256,
  actorSubject: 'synthetic-reviewed-operator',
  startedAt: '2026-10-02T01:09:00Z',
  appliedAt: '2026-10-02T01:10:00Z',
  recoveryReceiptKey: 'd1/synthetic.sql.recovery.json',
  pendingMigrations: [migrations.at(-1)],
  before: { migrations: migrations.slice(0, -1), tables, integrity: 'ok', foreignKeyViolations: 0 },
  after: {
    migrations,
    tables: structuredClone(tables),
    integrity: 'ok',
    foreignKeyViolations: 0,
    reviewedUpdates: 0,
    reviewedUpdateSourceRevision: 0,
  },
};
assert.equal(verifyReviewedUpdateMigration(input, trusted, 'before').ok, true);
const receipt = verifyReviewedUpdateMigration(input, trusted, 'after');
assert.equal(receipt.operation, 'controlled-production-0071');
assert.equal(receipt.recovery_receipt_sha256, trusted.recoveryReceiptSha256);
for (const [name, change] of [
  [
    'release',
    (v) => {
      v.releaseSha = 'f'.repeat(40);
    },
  ],
  [
    'SQL',
    (v) => {
      v.migrationSha256 = 'f'.repeat(64);
    },
  ],
  [
    'database',
    (v) => {
      v.databaseId = 'another';
    },
  ],
  [
    'pre-ledger',
    (v) => {
      v.before.migrations.pop();
    },
  ],
  [
    'post-ledger',
    (v) => {
      v.after.migrations.pop();
    },
  ],
  [
    'pending',
    (v) => {
      v.pendingMigrations.unshift('0070_credential_anomaly_review_revision.sql');
    },
  ],
  [
    'backup-key',
    (v) => {
      v.recoveryReceiptKey = 'unverified.json';
    },
  ],
  [
    'original',
    (v) => {
      v.after.tables.bid_evidence_freezes.sha256 = 'f'.repeat(64);
    },
  ],
  [
    'pinned-Mock',
    (v) => {
      v.after.tables.bid_session_policy_snapshots.count++;
    },
  ],
  [
    'qualification',
    (v) => {
      v.after.tables.member_qualification_events.sha256 = 'f'.repeat(64);
    },
  ],
  [
    'incomplete-witness',
    (v) => {
      v.before.tables.member_credentials = undefined;
    },
  ],
  [
    'missing-catalog',
    (v) => {
      v.before.tables.credential_catalog_metadata = undefined;
    },
  ],
  [
    'service-fact',
    (v) => {
      v.after.tables.member_service_evidence.count++;
    },
  ],
  [
    'tenure-fact',
    (v) => {
      v.after.tables.staffing_tenure_evidence.sha256 = 'f'.repeat(64);
    },
  ],
  [
    'source-import',
    (v) => {
      v.after.tables.assignment_import_rows.sha256 = 'f'.repeat(64);
    },
  ],
  [
    'integrity',
    (v) => {
      v.after.integrity = 'corrupt';
    },
  ],
  [
    'foreign-key',
    (v) => {
      v.after.foreignKeyViolations = 1;
    },
  ],
  [
    'capture',
    (v) => {
      v.after.reviewedUpdates = 1;
    },
  ],
  [
    'ledger-change',
    (v) => {
      v.after.reviewedUpdateSourceRevision = 1;
    },
  ],
]) {
  const changed = structuredClone(input);
  change(changed);
  assert.throws(() => verifyReviewedUpdateMigration(changed, trusted, 'after'), name);
}
for (const [name, change] of [
  [
    'backup-hash',
    (v) => {
      v.backupSha256 = 'f'.repeat(64);
    },
  ],
  [
    'backup-bytes',
    (v) => {
      v.backupBytes = 1;
    },
  ],
  [
    'bookmark',
    (v) => {
      v.recovery.time_travel_bookmark = '';
    },
  ],
  [
    'backup-release',
    (v) => {
      v.recovery.source_commit = 'f'.repeat(40);
    },
  ],
  [
    'old-backup',
    (v) => {
      v.recovery.bookmark_captured_at = '2026-10-01T01:00:00Z';
    },
  ],
]) {
  const changed = structuredClone(trusted);
  change(changed);
  assert.throws(() => verifyReviewedUpdateMigration(input, changed, 'before'), name);
}
assert.throws(() =>
  verifyReviewedUpdateMigration(
    input,
    { ...trusted, nowMs: Date.parse('2026-10-02T02:00:00Z') },
    'before',
  ),
);
const gzipTrusted = structuredClone(trusted);
gzipTrusted.recovery = {
  ...gzipTrusted.recovery,
  schema_version: 2,
  backup_key: 'd1/synthetic.sql.gz',
  transport_encoding: 'gzip',
  transport_sha256: 'f'.repeat(64),
  transport_bytes: 512,
};
gzipTrusted.backupTransportSha256 = gzipTrusted.recovery.transport_sha256;
gzipTrusted.backupTransportBytes = gzipTrusted.recovery.transport_bytes;
const gzipInput = {
  ...input,
  recoveryReceiptKey: `${gzipTrusted.recovery.backup_key}.recovery.json`,
};
assert.equal(verifyReviewedUpdateMigration(gzipInput, gzipTrusted, 'before').ok, true);
assert.equal(
  verifyReviewedUpdateMigration(gzipInput, gzipTrusted, 'after').backup_transport_sha256,
  gzipTrusted.backupTransportSha256,
);
for (const [name, change] of [
  [
    'missing transport hash proof',
    (v) => {
      v.backupTransportSha256 = undefined;
    },
  ],
  [
    'missing transport size proof',
    (v) => {
      v.backupTransportBytes = undefined;
    },
  ],
  [
    'wrong transport hash proof',
    (v) => {
      v.backupTransportSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong transport size proof',
    (v) => {
      v.backupTransportBytes += 1;
    },
  ],
  [
    'wrong transport encoding',
    (v) => {
      v.recovery.transport_encoding = 'identity';
    },
  ],
  [
    'wrong compressed key',
    (v) => {
      v.recovery.backup_key = 'd1/synthetic.sql';
    },
  ],
  [
    'unsupported receipt',
    (v) => {
      v.recovery.schema_version = 3;
    },
  ],
  [
    'oversized transport',
    (v) => {
      v.recovery.transport_bytes = v.backupTransportBytes = 314572801;
    },
  ],
  [
    'fractional transport',
    (v) => {
      v.recovery.transport_bytes = v.backupTransportBytes = 512.5;
    },
  ],
  [
    'nonfinite raw size',
    (v) => {
      v.recovery.backup_bytes = v.backupBytes = Number.POSITIVE_INFINITY;
    },
  ],
]) {
  const changed = structuredClone(gzipTrusted);
  change(changed);
  assert.throws(() => verifyReviewedUpdateMigration(gzipInput, changed, 'before'), name);
}
assert.throws(
  () =>
    verifyReviewedUpdateMigration(
      input,
      {
        ...trusted,
        recovery: { ...trusted.recovery, transport_encoding: 'gzip' },
      },
      'before',
    ),
  /Legacy SQL receipt transport is ambiguous/,
);

const taskTemporaryDirectory = mkdtempSync(join(tmpdir(), 'mbfd-backup-verify-'));
try {
  const raw = Buffer.from(
    '-- synthetic SQL evidence; no credentials or production state\n'.repeat(100),
  );
  const encoded = gzipSync(raw);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const rawPath = join(taskTemporaryDirectory, 'legacy.sql');
  const gzipPath = join(taskTemporaryDirectory, 'compressed.sql.gz');
  writeFileSync(rawPath, raw, { flag: 'wx' });
  writeFileSync(gzipPath, encoded, { flag: 'wx' });
  const legacyRecovery = {
    ...trusted.recovery,
    backup_bytes: raw.length,
    backup_sha256: hash(raw),
  };
  const compressedRecovery = {
    ...legacyRecovery,
    schema_version: 2,
    backup_key: 'd1/synthetic.sql.gz',
    transport_encoding: 'gzip',
    transport_bytes: encoded.length,
    transport_sha256: hash(encoded),
  };
  assert.deepEqual(await verifyBackupArtifact(rawPath, legacyRecovery), {
    backupBytes: raw.length,
    backupSha256: hash(raw),
  });
  const artifactProof = await verifyBackupArtifact(gzipPath, compressedRecovery);
  assert.deepEqual(artifactProof, {
    backupBytes: raw.length,
    backupSha256: hash(raw),
    backupTransportBytes: encoded.length,
    backupTransportSha256: hash(encoded),
  });
  assert.equal(
    verifyReviewedUpdateMigration(
      gzipInput,
      {
        ...trusted,
        recovery: compressedRecovery,
        ...artifactProof,
      },
      'before',
    ).ok,
    true,
  );
  await assert.rejects(
    verifyBackupArtifact(rawPath, { ...legacyRecovery, transport_encoding: 'gzip' }),
    /ambiguous/,
  );
  await assert.rejects(
    verifyBackupArtifact(gzipPath, { ...compressedRecovery, transport_sha256: undefined }),
    /transport receipt/,
  );
  await assert.rejects(
    verifyBackupArtifact(gzipPath, { ...compressedRecovery, transport_sha256: '0'.repeat(64) }),
    /Compressed transport integrity/,
  );
  await assert.rejects(
    verifyBackupArtifact(gzipPath, { ...compressedRecovery, transport_bytes: encoded.length - 1 }),
    /exceeds its verified receipt size/,
  );
  await assert.rejects(
    verifyBackupArtifact(gzipPath, { ...compressedRecovery, backup_sha256: '0'.repeat(64) }),
    /Original SQL integrity/,
  );
  await assert.rejects(
    verifyBackupArtifact(gzipPath, { ...compressedRecovery, backup_bytes: 1024 }),
    /Original SQL decoding\/integrity/,
  );
  await assert.rejects(
    verifyBackupArtifact(rawPath, { ...legacyRecovery, backup_sha256: '0'.repeat(64) }),
    /Original SQL integrity/,
  );
  const damaged = encoded.subarray(0, encoded.length - 8);
  const damagedPath = join(taskTemporaryDirectory, 'damaged.sql.gz');
  writeFileSync(damagedPath, damaged, { flag: 'wx' });
  await assert.rejects(
    verifyBackupArtifact(damagedPath, {
      ...compressedRecovery,
      transport_bytes: damaged.length,
      transport_sha256: hash(damaged),
    }),
    /Original SQL decoding\/integrity/,
  );
  await assert.rejects(
    verifyBackupArtifact(join(taskTemporaryDirectory, 'missing.sql'), legacyRecovery),
    /Original SQL decoding\/integrity/,
  );
} finally {
  const resolvedTemporaryDirectory = resolve(taskTemporaryDirectory);
  assert.equal(dirname(resolvedTemporaryDirectory), resolve(tmpdir()));
  assert.ok(basename(resolvedTemporaryDirectory).startsWith('mbfd-backup-verify-'));
  rmSync(resolvedTemporaryDirectory, { recursive: true, force: true });
}
process.stdout.write(
  'Reviewed-update migration verifier: legacy/gzip receipts, transport proof, streamed SQL hashes and corruption guards PASS.\n',
);
