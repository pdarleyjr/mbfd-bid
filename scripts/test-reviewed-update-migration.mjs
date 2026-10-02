import { strict as assert } from 'node:assert';
import { readdirSync } from 'node:fs';
import { verifyReviewedUpdateMigration } from './verify-reviewed-update-migration.mjs';

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
process.stdout.write('Reviewed-update migration receipt verifier: 28 checks PASS.\n');
