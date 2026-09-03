import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildProductionBaselineSql,
  planProductionBaseline,
} from '../../scripts/production-baseline-bootstrap-lib.js';

const SOURCE_HASH = 'a'.repeat(64);

const SCHEMA = `
  CREATE TABLE members (
    id INTEGER PRIMARY KEY,
    employee_id TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    rank TEXT NOT NULL,
    bid_category TEXT NOT NULL,
    rsc_seniority INTEGER NOT NULL,
    rank_seniority INTEGER,
    hired_at TEXT,
    promoted_at TEXT,
    is_probationary INTEGER NOT NULL,
    employment_status TEXT NOT NULL,
    employment_status_effective_on TEXT,
    separation_type TEXT,
    prior_position_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE credentials (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    fy_points_default INTEGER NOT NULL
  );
  CREATE TABLE member_credentials (
    member_id INTEGER NOT NULL,
    credential_id INTEGER NOT NULL,
    start_date TEXT,
    expiration_date TEXT,
    PRIMARY KEY (member_id, credential_id)
  );
  CREATE TABLE member_qualification_events (
    id TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL,
    credential_id INTEGER,
    specialty_code TEXT,
    specialty_terminal_status TEXT,
    kind TEXT NOT NULL,
    effective_on TEXT NOT NULL,
    expires_on TEXT,
    evidence_source TEXT NOT NULL,
    evidence_reference TEXT,
    reason TEXT NOT NULL,
    actor_subject TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    before_state TEXT NOT NULL,
    after_state TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE staffing_positions (
    id TEXT PRIMARY KEY,
    stable_slot_key TEXT NOT NULL UNIQUE,
    division TEXT,
    shift TEXT,
    station TEXT,
    unit TEXT,
    position_name TEXT,
    applicable_rank TEXT,
    active_from TEXT,
    active_to TEXT,
    review_status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE staffing_position_source_mappings (
    id TEXT PRIMARY KEY,
    staffing_position_id TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_locator TEXT NOT NULL,
    source_discriminator TEXT NOT NULL,
    source_signature TEXT NOT NULL,
    source_version TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE assignment_imports (
    id TEXT PRIMARY KEY,
    source_hash TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE assignment_import_rows (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL,
    resolved_member_id INTEGER,
    staffing_position_source_mapping_id TEXT,
    source_topology_completeness TEXT NOT NULL,
    reconciliation_classification TEXT
  );
`;

function seedReference(db: Database.Database) {
  db.exec(`
    INSERT INTO members VALUES
      (1, '1001', 'Alpha', 'One', 'FF', 'FF', 1, 1, NULL, NULL, 0, 'active', '2026-01-01', NULL, NULL, 1, 1),
      (2, '1002', 'Bravo', 'Two', 'LT', 'OFC', 2, 2, NULL, NULL, 0, 'active', '2026-01-01', NULL, NULL, 1, 1),
      (3, 'staging-only', 'Synthetic', 'Fixture', 'FF', 'FF', 3, 3, NULL, NULL, 0, 'active', '2026-01-01', NULL, NULL, 1, 1);
    INSERT INTO credentials VALUES (10, 'Paramedic', 2);
    INSERT INTO member_credentials VALUES
      (1, 10, '2025-01-01', NULL),
      (2, 10, '2025-01-01', NULL),
      (3, 10, '2025-01-01', NULL);
    INSERT INTO member_qualification_events VALUES
      ('q1', 1, 10, NULL, NULL, 'CERTIFICATION_GAINED', '2025-01-01', NULL,
       'reviewed', NULL, 'verified', 'admin', 'q1-key', '{}', '{}', 1),
      ('q3', 3, 10, NULL, NULL, 'CERTIFICATION_GAINED', '2025-01-01', NULL,
       'synthetic', NULL, 'fixture', 'admin', 'q3-key', '{}', '{}', 1);
    INSERT INTO staffing_positions VALUES
      ('p1', 'A-1-E1-FF', 'Operations', 'A', '1', 'E1', 'Firefighter', 'FF',
       '2026-01-01', NULL, 'approved', 1, 1);
    INSERT INTO staffing_position_source_mappings VALUES
      ('map1', 'p1', 'telestaff', '{"v":1}', 'primary', '${'b'.repeat(64)}',
       'TELSTAFF_ASSIGNMENTS_HTML_V1', '${SOURCE_HASH}', '2026-01-01', NULL, 1);
    INSERT INTO assignment_imports VALUES ('import1', '${SOURCE_HASH}', 'official', 'committed');
    INSERT INTO assignment_import_rows VALUES
      ('r1', 'import1', 1, 'map1', 'complete', 'NEW_ASSIGNMENT'),
      ('r2', 'import1', 2, NULL, 'incomplete', 'INCOMPLETE_TOPOLOGY'),
      ('r3', 'import1', NULL, NULL, 'complete', 'UNKNOWN_EMPLOYEE');
  `);
}

describe('production canonical baseline bootstrap plan', () => {
  let reference: Database.Database;
  let production: Database.Database;

  beforeEach(() => {
    reference = new Database(':memory:');
    production = new Database(':memory:');
    reference.exec(SCHEMA);
    production.exec(SCHEMA);
    seedReference(reference);
  });

  afterEach(() => {
    reference.close();
    production.close();
  });

  it('copies only official-source matched members and their reviewed canonical dependencies', () => {
    const plan = planProductionBaseline(reference, production, SOURCE_HASH);

    expect(plan.summary).toEqual({
      matchedMembers: 2,
      staffingPositions: 1,
      sourceMappings: 1,
      credentials: 1,
      memberCredentialReferences: 2,
      qualificationEvidence: 1,
      insertsRequired: 8,
    });
    const sql = buildProductionBaselineSql(plan);
    expect(sql).not.toContain('member_assignments');
    expect(sql).not.toContain('bid_sessions');
    expect(sql).not.toContain('audit_log');
    expect(sql).not.toContain('staging-only');
  });

  it('is idempotent after the deterministic plan is applied', () => {
    const first = planProductionBaseline(reference, production, SOURCE_HASH);
    production.exec(buildProductionBaselineSql(first));

    const second = planProductionBaseline(reference, production, SOURCE_HASH);
    expect(second.summary.insertsRequired).toBe(0);
    expect(buildProductionBaselineSql(second)).toBe(
      '-- no-op: production baseline already matches\n',
    );
  });

  it('fails closed when an Employee ID already belongs to different canonical data', () => {
    production.exec(`
      INSERT INTO members VALUES
        (99, '1001', 'Different', 'Person', 'FF', 'FF', 99, 99, NULL, NULL, 0,
         'active', '2026-01-01', NULL, NULL, 1, 1);
    `);

    expect(() => planProductionBaseline(reference, production, SOURCE_HASH)).toThrow(
      'PRODUCTION_MEMBER_EMPLOYEE_ID_CONFLICT',
    );
  });
});
