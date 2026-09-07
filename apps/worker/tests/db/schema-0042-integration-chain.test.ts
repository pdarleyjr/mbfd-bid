import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('.', import.meta.url));
const migrationsDirectory = resolve(directory, '../../migrations');

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
}

function applyThrough(sqlite: Database.Database, through: string): string[] {
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    if (file > through) break;
    sqlite.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
    applied.push(file);
  }
  return applied;
}

function applyOne(sqlite: Database.Database, file: string): void {
  sqlite.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
}

function expectFinalIntegrity(sqlite: Database.Database): void {
  expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);

  const triggers = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(triggers).toEqual(
    expect.arrayContaining([
      'rule_book_position_participation_draft_only_insert',
      'rule_book_position_participation_draft_only_update',
      'rule_book_position_participation_draft_only_delete',
      'rule_book_position_participation_rule_book_immutable',
    ]),
  );

  const indexes = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(indexes).toEqual(
    expect.arrayContaining([
      'idx_rule_book_position_participation_template',
      'idx_bid_preference_sheets_session_status',
      'idx_qualification_review_rows_batch',
      'idx_bid_post_bid_transitions_year_status',
    ]),
  );

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(tables).toEqual(
    expect.arrayContaining([
      'bid_preference_sheets',
      'bid_contact_attempts',
      'bid_session_checkpoints',
      'qualification_review_batches',
      'qualification_review_rows',
      'temporary_operational_overlays',
      'bid_post_bid_transitions',
      'bid_post_bid_operation_receipts',
      'annual_bid_policy_documents',
      'credential_catalog_metadata',
      'credential_catalog_receipts',
      'annual_plan_reviews',
      'annual_plan_receipts',
      'annual_source_revision',
      'organization_units',
      'organization_unit_versions',
      'organization_staffing_links',
      'organization_command_receipts',
      'annual_rule_profile_revisions',
      'annual_freeze_reviews',
      'member_service_evidence',
      'staffing_tenure_evidence',
      'post_award_obligation_reviews',
      'admin_configuration_receipts',
    ]),
  );
}

describe('integration migration chain 0038 through 0058', () => {
  it('is gap-free and applies from a fresh database through the final candidate', () => {
    expect(migrationFiles().slice(-21)).toEqual([
      '0038_live_policy_participation_and_amendments.sql',
      '0039_restore_rule_book_participation_guards.sql',
      '0040_annual_bid_operations.sql',
      '0041_year_round_operations.sql',
      '0042_post_bid_transition.sql',
      '0043_annual_bid_policy_documents.sql',
      '0044_annual_policy_session_evidence.sql',
      '0045_credential_catalog_identity.sql',
      '0046_annual_plan_review.sql',
      '0047_organization_catalog.sql',
      '0048_annual_rule_profiles.sql',
      '0049_annual_freeze_reviews.sql',
      '0050_member_service_evidence.sql',
      '0051_staffing_tenure_evidence.sql',
      '0052_post_award_obligation_reviews.sql',
      '0053_admin_configuration_receipts.sql',
      '0054_credential_collision_guards.sql',
      '0055_annual_source_review_checkpoints.sql',
      '0056_targetsolutions_reconciliation.sql',
      '0057_admin_working_drafts.sql',
      '0058_bid_source_decisions.sql',
    ]);

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const applied = applyThrough(sqlite, '0058_bid_source_decisions.sql');
    expect(applied.at(-1)).toBe('0058_bid_source_decisions.sql');
    expectFinalIntegrity(sqlite);

    // A D1 migration ledger would record every applied filename; a second
    // discovery sees no pending migration rather than replaying SQL files.
    const migrationLedger = new Set(applied);
    expect(migrationFiles().filter((file) => !migrationLedger.has(file))).toEqual([]);
    sqlite.close();
  });

  it('applies each required upgrade boundary in the intended order', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyThrough(sqlite, '0037_staffing_baseline_trigger_decomposition.sql');

    applyOne(sqlite, '0038_live_policy_participation_and_amendments.sql');
    applyOne(sqlite, '0039_restore_rule_book_participation_guards.sql');
    applyOne(sqlite, '0040_annual_bid_operations.sql');
    applyOne(sqlite, '0041_year_round_operations.sql');
    applyOne(sqlite, '0042_post_bid_transition.sql');
    applyOne(sqlite, '0043_annual_bid_policy_documents.sql');
    applyOne(sqlite, '0044_annual_policy_session_evidence.sql');
    applyOne(sqlite, '0045_credential_catalog_identity.sql');
    applyOne(sqlite, '0046_annual_plan_review.sql');
    applyOne(sqlite, '0047_organization_catalog.sql');
    applyOne(sqlite, '0048_annual_rule_profiles.sql');
    applyOne(sqlite, '0049_annual_freeze_reviews.sql');
    applyOne(sqlite, '0050_member_service_evidence.sql');
    applyOne(sqlite, '0051_staffing_tenure_evidence.sql');
    applyOne(sqlite, '0052_post_award_obligation_reviews.sql');
    applyOne(sqlite, '0053_admin_configuration_receipts.sql');
    applyOne(sqlite, '0054_credential_collision_guards.sql');
    applyOne(sqlite, '0055_annual_source_review_checkpoints.sql');

    expectFinalIntegrity(sqlite);
    const bidYearColumns = sqlite.pragma('table_info(bid_years)') as Array<{ name: string }>;
    expect(bidYearColumns.map((column) => column.name)).toContain('annual_policy_document_id');
    sqlite.close();
  });

  it('preserves a populated pre-candidate estate and its frozen V1 session bytes', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyThrough(sqlite, '0044_annual_policy_session_evidence.sql');
    sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,created_at,updated_at)
        VALUES (71001,'synthetic-upgrade-member','Synthetic','Upgrade','FF','FF',1,1,0,1,1);
      INSERT INTO credentials (id,name,fy_points_default) VALUES (71001,'Synthetic upgrade credential',2);
      INSERT INTO member_credentials (member_id,credential_id,start_date,expiration_date) VALUES (71001,71001,'2025-01-01','2027-01-01');
      INSERT INTO position_templates (version,effective_year) VALUES ('synthetic-upgrade',2025);
      INSERT INTO rule_books (version,effective_year,status) VALUES ('synthetic-upgrade',2025,'draft');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-seat','synthetic-upgrade','A','1','Combat','Engine','FF','Synthetic seat');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('synthetic-upgrade','synthetic-seat','synthetic-upgrade','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":2,"items":[]}','["rsc_seniority"]');
      INSERT INTO bid_years (year,status,position_template_version,rule_book_version) VALUES (2025,'configuring','synthetic-upgrade','synthetic-upgrade');
      INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock) VALUES ('synthetic-upgrade-session',2025,1,'officers',1);
      INSERT INTO staffing_positions (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
        VALUES ('synthetic-staffing-seat','synthetic-staffing-seat','A','1','Engine','Synthetic seat','FF','2025-01-01','approved',1,1);
      INSERT INTO member_assignments (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
        VALUES ('synthetic-assignment',71001,'synthetic-staffing-seat','ADMIN_TRANSFER','synthetic-reviewed-transfer','active','2025-01-01',1,1);
    `);
    const snapshot = BidSessionPolicySnapshotSchema.parse({
      v: 1,
      ruleBookVersion: 'synthetic-upgrade',
      positionTemplateVersion: 'synthetic-upgrade',
      capturedAtMs: 1,
      members: [
        {
          memberId: 71001,
          pool: 'FF',
          rscSeniority: 1,
          rankSeniority: 1,
          exclusionReason: null,
          authoritativeAssignmentId: null,
        },
      ],
    });
    sqlite
      .prepare(
        'INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,snapshot_json,captured_at) VALUES (?,?,?,?,1)',
      )
      .run(
        'synthetic-upgrade-session',
        'synthetic-upgrade',
        'synthetic-upgrade',
        JSON.stringify(snapshot),
      );
    const tables = [
      'members',
      'credentials',
      'member_credentials',
      'position_templates',
      'rule_books',
      'positions',
      'position_rules',
      'bid_years',
      'bid_sessions',
      'bid_session_policy_snapshots',
      'staffing_positions',
      'member_assignments',
    ];
    const before = new Map(
      tables.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
    for (const file of migrationFiles().filter(
      (f) => f > '0044_annual_policy_session_evidence.sql',
    ))
      applyOne(sqlite, file);
    for (const table of tables)
      expect(sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(
        before.get(table),
      );
    const saved = sqlite
      .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots')
      .get() as { snapshot_json: string };
    expect(BidSessionPolicySnapshotSchema.parse(JSON.parse(saved.snapshot_json))).toEqual(snapshot);
    expect(() => sqlite.exec("UPDATE bid_session_policy_snapshots SET snapshot_json='{}'")).toThrow(
      'immutable',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM annual_plan_reviews').get()).toEqual({ n: 0 });
    expectFinalIntegrity(sqlite);
    sqlite.close();
  });

  it('preserves historical credential identities on upgrade and rejects new casefold collisions atomically', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyThrough(sqlite, '0044_annual_policy_session_evidence.sql');
    sqlite.exec(
      "INSERT INTO credentials (id,name,fy_points_default) VALUES (1,'Synthetic Legacy',3),(2,'synthetic legacy',4),(3,'Synthetic Other',2)",
    );
    const before = sqlite.prepare('SELECT * FROM credentials ORDER BY id').all();
    for (const file of migrationFiles().filter(
      (f) => f > '0044_annual_policy_session_evidence.sql',
    ))
      applyOne(sqlite, file);
    expect(sqlite.prepare('SELECT * FROM credentials ORDER BY id').all()).toEqual(before);
    expect(() =>
      sqlite.exec("INSERT INTO credentials (name,fy_points_default) VALUES ('SYNTHETIC LEGACY',6)"),
    ).toThrow(/collision/);
    sqlite.exec(
      "INSERT INTO credential_catalog_metadata (credential_id,display_name,revision) VALUES (3,'Synthetic Display',1)",
    );
    expect(() =>
      sqlite.exec(
        "INSERT INTO credentials (name,fy_points_default) VALUES ('synthetic display',6)",
      ),
    ).toThrow(/collision/);
    expect(() =>
      sqlite.exec(
        "INSERT INTO credential_catalog_metadata (credential_id,display_name,revision) VALUES (1,'SYNTHETIC DISPLAY',1)",
      ),
    ).toThrow(/collision/);
    expect(() =>
      sqlite.exec(
        "UPDATE credential_catalog_metadata SET display_name='SYNTHETIC LEGACY' WHERE credential_id=3",
      ),
    ).toThrow(/collision/);
    expect(sqlite.prepare('SELECT * FROM credentials ORDER BY id').all()).toEqual(before);
    expectFinalIntegrity(sqlite);
    sqlite.close();
  });
});
