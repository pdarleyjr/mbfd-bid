import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function applyMigrationsStrict(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function insertSyntheticMember(sqlite: Database.Database, id: number): void {
  sqlite
    .prepare(
      'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, `synthetic-${id}`, 'Synthetic', 'Member', 'Chief', 'Admin', id, 1, 1);
}

function insertApprovedSlot(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      'INSERT INTO staffing_positions (id, stable_slot_key, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, `SYNTHETIC/${id}`, 'approved', 1, 1);
}

function insertStagedImport(sqlite: Database.Database, id: string, inputRowCount: number): void {
  sqlite
    .prepare(
      'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, input_row_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, 'telestaff', 'synthetic-v1', 'a'.repeat(64), inputRowCount, 'staged', 1);
}

function advanceImportToReviewed(sqlite: Database.Database, importId: string): void {
  sqlite.prepare('UPDATE assignment_imports SET status = ? WHERE id = ?').run('reviewed', importId);
}

function approveImport(sqlite: Database.Database, importId: string, actorId: number): void {
  sqlite
    .prepare(
      'UPDATE assignment_imports SET status = ?, approved_at = ?, approved_by_member_id = ? WHERE id = ?',
    )
    .run('approved', 2, actorId, importId);
}

function commitImport(sqlite: Database.Database, importId: string): void {
  sqlite
    .prepare('UPDATE assignment_imports SET status = ?, committed_at = ? WHERE id = ?')
    .run('committed', 3, importId);
}

describe('V2 staffing reconciliation schema (migration 0024)', () => {
  it('exports forward-only classification fields and a separate missing-observation finding', () => {
    expect(Object.hasOwn(schema.assignmentImports, 'reconciliationRevision')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImportRows, 'reconciliationClassification')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImportRows, 'resolutionAction')).toBe(true);
    expect(schema.assignmentImportMissingObservations).toBeDefined();
  });

  it('requires an explicit reviewed decision for negative source evidence without deleting staffing capacity', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);

    insertSyntheticMember(sqlite, 1);
    insertApprovedSlot(sqlite, 'slot-1');
    sqlite
      .prepare(
        'INSERT INTO member_assignments (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'assignment-1',
        1,
        'slot-1',
        'ADMIN_TRANSFER',
        'synthetic-admin-adjustment',
        'active',
        '2026-01-01',
        1,
        1,
      );
    insertStagedImport(sqlite, 'import-missing', 0);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_missing_observations (id, import_id, member_assignment_id, classification, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'finding-missing-1',
        'import-missing',
        'assignment-1',
        'MISSING_OBSERVATION',
        'pending',
        1,
      );
    const revisionAfterFinding = sqlite
      .prepare('SELECT reconciliation_revision AS revision FROM assignment_imports WHERE id = ?')
      .get('import-missing') as { revision: number };
    expect(revisionAfterFinding.revision).toBe(1);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, normalized_source_topology, disposition, review_status, reconciliation_classification, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'invalid-missing-row',
          'import-missing',
          1,
          'b'.repeat(64),
          'synthetic-missing',
          'missing_vanished',
          'pending',
          'MISSING_OBSERVATION',
          1,
        ),
    ).toThrow();

    advanceImportToReviewed(sqlite, 'import-missing');
    expect(() => approveImport(sqlite, 'import-missing', 1)).toThrow();

    sqlite
      .prepare(
        'UPDATE assignment_import_missing_observations SET review_status = ?, resolution_action = ?, reviewed_at = ?, reviewed_by_member_id = ?, resolution_reason = ? WHERE id = ?',
      )
      .run(
        'resolved',
        'RETAIN_ASSIGNMENT',
        2,
        1,
        'Synthetic review retains the authoritative occupancy.',
        'finding-missing-1',
      );
    const revisionAfterResolution = sqlite
      .prepare('SELECT reconciliation_revision AS revision FROM assignment_imports WHERE id = ?')
      .get('import-missing') as { revision: number };
    expect(revisionAfterResolution.revision).toBe(2);
    expect(() =>
      sqlite
        .prepare(
          'UPDATE assignment_import_missing_observations SET created_at = created_at WHERE id = ?',
        )
        .run('finding-missing-1'),
    ).toThrow();

    expect(() => approveImport(sqlite, 'import-missing', 1)).not.toThrow();
    expect(() => commitImport(sqlite, 'import-missing')).not.toThrow();

    const slotCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM staffing_positions WHERE id = ?')
      .get('slot-1') as { count: number };
    const assignment = sqlite
      .prepare('SELECT status FROM member_assignments WHERE id = ?')
      .get('assignment-1') as { status: string };
    expect(slotCount.count).toBe(1);
    expect(assignment.status).toBe('active');
    sqlite.close();
  });

  it('allows a reviewed deferred new position to commit no capacity while unknown employees remain blocking', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertSyntheticMember(sqlite, 1);

    insertStagedImport(sqlite, 'import-new-position', 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, normalized_source_topology, disposition, review_status, reviewed_at, reviewed_by_member_id, resolution_reason, reconciliation_classification, resolution_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-new-position',
        'import-new-position',
        1,
        'c'.repeat(64),
        'synthetic-new-position',
        'ambiguous_mapping',
        'approved',
        2,
        1,
        'Synthetic source locator requires baseline review.',
        'NEW_POSITION',
        'DEFER_NEW_POSITION',
        1,
      );
    advanceImportToReviewed(sqlite, 'import-new-position');
    expect(() => approveImport(sqlite, 'import-new-position', 1)).not.toThrow();
    expect(() => commitImport(sqlite, 'import-new-position')).not.toThrow();
    const capacity = sqlite.prepare('SELECT COUNT(*) AS count FROM staffing_positions').get() as {
      count: number;
    };
    const observations = sqlite
      .prepare('SELECT COUNT(*) AS count FROM assignment_observations')
      .get() as { count: number };
    expect(capacity.count).toBe(0);
    expect(observations.count).toBe(0);

    insertStagedImport(sqlite, 'import-unknown', 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, normalized_source_topology, disposition, review_status, reviewed_at, reviewed_by_member_id, resolution_reason, reconciliation_classification, resolution_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'row-unknown',
        'import-unknown',
        1,
        'd'.repeat(64),
        'synthetic-known-slot',
        'unknown_employee',
        'rejected',
        2,
        1,
        'Synthetic unresolved employee remains blocking.',
        'UNKNOWN_EMPLOYEE',
        'REJECT_SOURCE_ROW',
        1,
      );
    advanceImportToReviewed(sqlite, 'import-unknown');
    expect(() => approveImport(sqlite, 'import-unknown', 1)).toThrow();
    sqlite.close();
  });
});
