import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

function applyMigrationsStrict(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((candidate) => candidate.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function insertActorAndBidYear(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'synthetic-actor', 'Synthetic', 'Actor', 'CHIEF', 'Chief', 1, 0, ?, ?)`,
    )
    .run(NOW, NOW);
  sqlite.prepare("UPDATE bid_years SET status = 'configuring' WHERE year = 2027").run();
}

function insertStagedImport(
  sqlite: Database.Database,
  id: string,
  inputRows = 1,
  sourceKind: 'official' | 'synthetic_test' = 'official',
  sourceFormat:
    | 'TELSTAFF_ASSIGNMENTS_HTML_V1'
    | 'TELSTAFF_ASSIGNMENTS_LEGACY_V1' = 'TELSTAFF_ASSIGNMENTS_HTML_V1',
  sourceSnapshotAsOf: string | null = null,
  parserVersion = 'telestaff-assignments-html@1',
): void {
  sqlite
    .prepare(
      `INSERT INTO assignment_imports
          (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
           input_row_count, normalized_data_row_count, unique_employee_count,
           report_row_count, structural_row_count, source_snapshot_as_of, status, created_at)
        VALUES (?, 'telestaff', 'synthetic-v1', ?, ?,
          ?, ?, ?, ?, ?, ?, 0, ?, 'staged', ?)`,
    )
    .run(
      id,
      'a'.repeat(64),
      sourceFormat,
      parserVersion,
      sourceKind,
      inputRows,
      inputRows,
      inputRows,
      inputRows,
      sourceSnapshotAsOf,
      NOW,
    );
}

function insertIncompleteSourceRow(
  sqlite: Database.Database,
  importId: string,
  sourceRowNumber: number,
  fingerprint: string,
  employeeHmac: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          normalized_source_topology, source_topology_completeness, disposition,
          reconciliation_classification, review_status, resolution_action,
          reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'incomplete', 'ambiguous_mapping',
         'INCOMPLETE_TOPOLOGY', 'approved', 'RETAIN_UNMATERIALIZED_SOURCE_ROW',
         ?, 1, 'Synthetic incomplete source evidence retained.', ?)`,
    )
    .run(
      `${importId}-row-${sourceRowNumber}`,
      importId,
      sourceRowNumber,
      fingerprint,
      employeeHmac,
      JSON.stringify({
        v: 1,
        shift: 'A Shift',
        division: 'Suppression/Rescue',
        station: 'HQ',
        unit: null,
        position: null,
      }),
      NOW,
      NOW,
    );
}

describe('authoritative staffing baseline schema (migration 0026)', () => {
  it('exports immutable source-format accounting and annual baseline designation fields', () => {
    expect(Object.hasOwn(schema.assignmentImports, 'sourceFormat')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'parserVersion')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'sourceKind')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'normalizedDataRowCount')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'uniqueEmployeeCount')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'reportRowCount')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'structuralRowCount')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImportRows, 'sourceTopologyCompleteness')).toBe(true);
    expect(schema.bidYearStaffingBaselines).toBeDefined();
  });

  it('rejects duplicate opaque source identities/fingerprints and prevents incomplete topology from claiming a mapping', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertActorAndBidYear(sqlite);
    insertStagedImport(sqlite, 'duplicate-fingerprint', 2);
    insertIncompleteSourceRow(sqlite, 'duplicate-fingerprint', 1, 'b'.repeat(64), 'c'.repeat(64));
    expect(() =>
      insertIncompleteSourceRow(sqlite, 'duplicate-fingerprint', 2, 'b'.repeat(64), 'd'.repeat(64)),
    ).toThrow();

    insertStagedImport(sqlite, 'duplicate-identity', 2);
    insertIncompleteSourceRow(sqlite, 'duplicate-identity', 1, 'e'.repeat(64), 'f'.repeat(64));
    expect(() =>
      insertIncompleteSourceRow(sqlite, 'duplicate-identity', 2, 'g'.repeat(64), 'f'.repeat(64)),
    ).toThrow();

    sqlite
      .prepare(
        `INSERT INTO staffing_positions
           (id, stable_slot_key, review_status, created_at, updated_at)
         VALUES ('forbidden-slot', 'SYNTHETIC/FORBIDDEN', 'approved', ?, ?)`,
      )
      .run(NOW, NOW);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO assignment_import_rows
             (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
              staffing_position_source_mapping_id, normalized_source_topology,
              source_topology_completeness, disposition, reconciliation_classification,
              review_status, resolution_action, reviewed_at, reviewed_by_member_id,
              resolution_reason, created_at)
           VALUES ('incomplete-with-mapping', 'duplicate-identity', 3, ?, ?, 'forbidden-slot',
             'synthetic/incomplete', 'incomplete', 'ambiguous_mapping', 'INCOMPLETE_TOPOLOGY',
             'approved', 'RETAIN_UNMATERIALIZED_SOURCE_ROW', ?, 1,
             'Synthetic invalid canonical mapping.', ?)`,
        )
        .run('h'.repeat(64), 'i'.repeat(64), NOW, NOW),
    ).toThrow();

    insertStagedImport(sqlite, 'boolean-version-topology');
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO assignment_import_rows
             (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
              normalized_source_topology, source_topology_completeness, disposition,
              reconciliation_classification, review_status, created_at)
           VALUES ('boolean-version-row', 'boolean-version-topology', 1, ?, ?, ?, 'complete',
             'unchanged', 'UNCHANGED', 'not_required', ?)`,
        )
        .run(
          'l'.repeat(64),
          'm'.repeat(64),
          JSON.stringify({
            v: true,
            shift: 'A Shift',
            division: 'Suppression/Rescue',
            station: 'HQ',
            unit: 'Engine 1',
            position: 'Firefighter',
          }),
          NOW,
        ),
    ).toThrow();

    insertStagedImport(sqlite, 'duplicate-json-key-topology');
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO assignment_import_rows
             (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
              normalized_source_topology, source_topology_completeness, disposition,
              reconciliation_classification, review_status, created_at)
           VALUES ('duplicate-json-key-row', 'duplicate-json-key-topology', 1, ?, ?, ?, 'complete',
             'unchanged', 'UNCHANGED', 'not_required', ?)`,
        )
        .run(
          'n'.repeat(64),
          'o'.repeat(64),
          '{"v":1,"shift":"A Shift","shift":null,"division":"Suppression/Rescue","station":"HQ","unit":"Engine 1","position":"Firefighter"}',
          NOW,
        ),
    ).toThrow();
    sqlite.close();
  });

  it('rejects malformed source snapshots and whitespace-only complete HTML topology at the database boundary', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertActorAndBidYear(sqlite);

    expect(() =>
      insertStagedImport(
        sqlite,
        'invalid-snapshot',
        1,
        'official',
        'TELSTAFF_ASSIGNMENTS_HTML_V1',
        '2026-02-3x',
      ),
    ).toThrow();

    insertStagedImport(sqlite, 'whitespace-topology');
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO assignment_import_rows
             (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
              normalized_source_topology, source_topology_completeness, disposition,
              reconciliation_classification, review_status, created_at)
           VALUES ('whitespace-topology-row', 'whitespace-topology', 1, ?, ?, ?, 'complete',
             'unchanged', 'UNCHANGED', 'not_required', ?)`,
        )
        .run(
          'j'.repeat(64),
          'k'.repeat(64),
          JSON.stringify({
            v: 1,
            shift: 'A Shift',
            division: 'Suppression/Rescue',
            station: 'HQ',
            unit: '\u2007',
            position: 'Firefighter',
          }),
          NOW,
        ),
    ).toThrow();
    sqlite.close();
  });

  it('rejects a committed legacy row with a NULL classification from baseline acceptance', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertActorAndBidYear(sqlite);
    insertStagedImport(
      sqlite,
      'null-classification-import',
      1,
      'official',
      'TELSTAFF_ASSIGNMENTS_LEGACY_V1',
    );
    sqlite
      .prepare(
        `INSERT INTO members
           (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
            is_probationary, created_at, updated_at)
         VALUES (2, 'synthetic-member', 'Synthetic', 'Member', 'FF', 'FF', 2, 0, ?, ?)`,
      )
      .run(NOW, NOW);
    sqlite
      .prepare(
        `INSERT INTO staffing_positions
           (id, stable_slot_key, review_status, created_at, updated_at)
         VALUES ('null-classification-slot', 'SYNTHETIC/NULL/CLASSIFICATION', 'approved', ?, ?)`,
      )
      .run(NOW, NOW);
    sqlite
      .prepare(
        `INSERT INTO staffing_position_source_mappings
           (id, staffing_position_id, source_system, source_locator, source_signature,
            source_version, source_hash, effective_from, created_at)
         VALUES ('null-classification-mapping', 'null-classification-slot', 'telestaff',
           'synthetic/null-classification', ?, 'synthetic-v1', ?, '2026-01-01', ?)`,
      )
      .run('b'.repeat(64), 'a'.repeat(64), NOW);
    sqlite
      .prepare(
        `INSERT INTO assignment_import_rows
           (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
            resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology,
            disposition, reconciliation_classification, review_status, created_at)
         VALUES ('null-classification-row', 'null-classification-import', 1, ?, ?, 2,
           'null-classification-mapping', 'synthetic/null-classification',
           'unchanged', NULL, 'not_required', ?)`,
      )
      .run('c'.repeat(64), 'd'.repeat(64), NOW);
    sqlite
      .prepare("UPDATE assignment_imports SET status = 'reviewed' WHERE id = ?")
      .run('null-classification-import');
    sqlite
      .prepare(
        "UPDATE assignment_imports SET status = 'approved', approved_at = ?, approved_by_member_id = 1 WHERE id = ?",
      )
      .run(NOW, 'null-classification-import');
    sqlite
      .prepare("UPDATE assignment_imports SET status = 'committed', committed_at = ? WHERE id = ?")
      .run(NOW, 'null-classification-import');

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO bid_year_staffing_baselines
             (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
              acceptance_reason, created_at)
           VALUES ('null-classification-baseline', 2027, 'null-classification-import', 'accepted',
             ?, 1, 'A NULL classification must never be accepted.', ?)`,
        )
        .run(NOW, NOW),
    ).toThrow();
    sqlite.close();
  });

  it('accepts only complete official source evidence and permits ledger history only through explicit supersession', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertActorAndBidYear(sqlite);
    const accept = (id: string, importId: string) =>
      sqlite
        .prepare(
          `INSERT INTO bid_year_staffing_baselines
             (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
              acceptance_reason, created_at)
           VALUES (?, 2027, ?, 'accepted', ?, 1, 'Synthetic source baseline accepted.', ?)`,
        )
        .run(id, importId, NOW, NOW);
    const finalize = (importId: string) => {
      sqlite
        .prepare("UPDATE assignment_imports SET status = 'reviewed' WHERE id = ?")
        .run(importId);
      sqlite
        .prepare(
          "UPDATE assignment_imports SET status = 'approved', approved_at = ?, approved_by_member_id = 1 WHERE id = ?",
        )
        .run(NOW, importId);
      sqlite
        .prepare(
          "UPDATE assignment_imports SET status = 'committed', committed_at = ? WHERE id = ?",
        )
        .run(NOW, importId);
    };

    // Legacy uncounted data remains fail-closed even if the older status
    // lifecycle can technically reach committed with zero rows.
    insertStagedImport(sqlite, 'empty-import', 0, 'official', 'TELSTAFF_ASSIGNMENTS_LEGACY_V1');
    finalize('empty-import');
    expect(() => accept('empty-baseline', 'empty-import')).toThrow();

    insertStagedImport(sqlite, 'partial-import', 2);
    insertIncompleteSourceRow(sqlite, 'partial-import', 1, '1'.repeat(64), '2'.repeat(64));
    expect(() => finalize('partial-import')).toThrow();
    expect(() => accept('partial-baseline', 'partial-import')).toThrow();

    insertStagedImport(sqlite, 'synthetic-import', 1, 'synthetic_test');
    insertIncompleteSourceRow(sqlite, 'synthetic-import', 1, '3'.repeat(64), '4'.repeat(64));
    finalize('synthetic-import');
    expect(() => accept('synthetic-baseline', 'synthetic-import')).toThrow();

    // Legacy source inserts do not run the HTML-format insert trigger, so the
    // baseline ledger independently rejects a malformed optional snapshot.
    insertStagedImport(
      sqlite,
      'malformed-legacy-snapshot',
      1,
      'official',
      'TELSTAFF_ASSIGNMENTS_LEGACY_V1',
      '2026-02-3x',
    );
    insertIncompleteSourceRow(
      sqlite,
      'malformed-legacy-snapshot',
      1,
      '7'.repeat(64),
      '8'.repeat(64),
    );
    finalize('malformed-legacy-snapshot');
    expect(() => accept('malformed-legacy-baseline', 'malformed-legacy-snapshot')).toThrow();

    // A legacy import bypasses the HTML-specific manifest trigger, so the
    // annual ledger independently rejects parser provenance made only of
    // semantic whitespace.
    insertStagedImport(
      sqlite,
      'whitespace-parser-version',
      1,
      'official',
      'TELSTAFF_ASSIGNMENTS_LEGACY_V1',
      null,
      '\u00a0',
    );
    insertIncompleteSourceRow(
      sqlite,
      'whitespace-parser-version',
      1,
      'b'.repeat(64),
      'c'.repeat(64),
    );
    finalize('whitespace-parser-version');
    expect(() => accept('whitespace-parser-baseline', 'whitespace-parser-version')).toThrow();

    // The legacy topology column was created before the versioned HTML
    // contract and SQLite's default trim does not classify NBSP as blank.
    // The baseline trigger uses the evaluator's Unicode-whitespace semantics.
    insertStagedImport(
      sqlite,
      'whitespace-legacy-topology',
      1,
      'official',
      'TELSTAFF_ASSIGNMENTS_LEGACY_V1',
    );
    sqlite
      .prepare(
        `INSERT INTO assignment_import_rows
           (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
            normalized_source_topology, source_topology_completeness, disposition,
            reconciliation_classification, review_status, resolution_action,
            reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
         VALUES ('whitespace-legacy-row', 'whitespace-legacy-topology', 1, ?, ?, ?,
           'incomplete', 'ambiguous_mapping', 'INCOMPLETE_TOPOLOGY', 'approved',
           'RETAIN_UNMATERIALIZED_SOURCE_ROW', ?, 1,
           'Whitespace-only legacy topology must remain blocked.', ?)`,
      )
      .run('d'.repeat(64), 'e'.repeat(64), '\u00a0', NOW, NOW);
    finalize('whitespace-legacy-topology');
    expect(() => accept('whitespace-legacy-baseline', 'whitespace-legacy-topology')).toThrow();

    // An ambiguous mapping with incomplete source topology cannot become a
    // terminal reviewed rejection; the evaluator and ledger both keep it
    // blocked until the source topology itself is resolved.
    insertStagedImport(sqlite, 'ambiguous-incomplete-topology', 1);
    sqlite
      .prepare(
        `INSERT INTO assignment_import_rows
           (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
            normalized_source_topology, source_topology_completeness, disposition,
            reconciliation_classification, review_status, resolution_action,
            reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
         VALUES ('ambiguous-incomplete-row', 'ambiguous-incomplete-topology', 1, ?, ?, ?,
           'incomplete', 'ambiguous_mapping', 'AMBIGUOUS_MAPPING', 'rejected',
           'REJECT_SOURCE_ROW', ?, 1, 'Incomplete ambiguous source topology is not terminal.', ?)`,
      )
      .run(
        '9'.repeat(64),
        'a'.repeat(64),
        JSON.stringify({
          v: 1,
          shift: 'A Shift',
          division: 'Suppression/Rescue',
          station: 'HQ',
          unit: null,
          position: 'Firefighter',
        }),
        NOW,
        NOW,
      );
    finalize('ambiguous-incomplete-topology');
    expect(() =>
      accept('ambiguous-incomplete-baseline', 'ambiguous-incomplete-topology'),
    ).toThrow();

    insertStagedImport(sqlite, 'accepted-import', 1);
    insertIncompleteSourceRow(sqlite, 'accepted-import', 1, '5'.repeat(64), '6'.repeat(64));
    finalize('accepted-import');
    expect(() =>
      sqlite
        .prepare(
          "UPDATE assignment_imports SET parser_version = 'changed' WHERE id = 'accepted-import'",
        )
        .run(),
    ).toThrow();

    accept('accepted-baseline', 'accepted-import');
    sqlite.prepare("UPDATE bid_years SET status = 'configuring' WHERE year = 2028").run();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO bid_year_staffing_baselines
             (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
              acceptance_reason, created_at)
           VALUES ('cross-year-baseline', 2028, 'accepted-import', 'accepted',
             ?, 1, 'A source snapshot cannot be reused for another Bid year.', ?)`,
        )
        .run(NOW, NOW),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          "UPDATE bid_year_staffing_baselines SET acceptance_reason = 'changed' WHERE id = 'accepted-baseline'",
        )
        .run(),
    ).toThrow();
    expect(() => accept('second-accepted-baseline', 'accepted-import')).toThrow();
    sqlite
      .prepare(
        `UPDATE bid_year_staffing_baselines
         SET status = 'superseded', superseded_at = ?, superseded_by_member_id = ?,
             supersession_reason = ?
         WHERE id = 'accepted-baseline'`,
      )
      .run(NOW + 1, 1, 'Synthetic newer source accepted elsewhere.');
    expect(
      sqlite
        .prepare('SELECT status FROM bid_year_staffing_baselines WHERE id = ?')
        .get('accepted-baseline'),
    ).toEqual({ status: 'superseded' });
    sqlite.close();
  });
});
