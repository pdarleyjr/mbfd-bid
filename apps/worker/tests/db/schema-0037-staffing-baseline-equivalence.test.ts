import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

function applyMigrations(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((candidate) => candidate.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function insertActorAndYear(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'equivalence-actor', 'Synthetic', 'Actor', 'CHIEF', 'Chief', 1, 0, ?, ?)`,
    )
    .run(NOW, NOW);
  sqlite.prepare("UPDATE bid_years SET status = 'configuring' WHERE year = 2027").run();
}

type ImportFixtureOptions = {
  inputRowCount?: number;
  normalizedDataRowCount?: number;
  parserVersion?: string;
  reportRowCount?: number;
  structuralRowCount?: number;
  sourceHash?: string;
  sourceKind?: 'official' | 'synthetic_test';
  sourceSnapshotAsOf?: string | null;
  sourceSystem?: string;
  topology?: string;
  uniqueEmployeeCount?: number;
};

function insertCompleteImport(
  sqlite: Database.Database,
  id: string,
  options: ImportFixtureOptions = {},
): void {
  const inputRowCount = options.inputRowCount ?? 1;
  const normalizedDataRowCount = options.normalizedDataRowCount ?? inputRowCount;
  const uniqueEmployeeCount = options.uniqueEmployeeCount ?? inputRowCount;
  const structuralRowCount = options.structuralRowCount ?? 0;
  const reportRowCount = options.reportRowCount ?? normalizedDataRowCount + structuralRowCount;
  sqlite
    .prepare(
      `INSERT INTO assignment_imports
         (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
          input_row_count, normalized_data_row_count, unique_employee_count,
          report_row_count, structural_row_count, source_snapshot_as_of, status, created_at)
       VALUES (?, ?, 'equivalence-v1', ?, 'TELSTAFF_ASSIGNMENTS_HTML_V1',
         ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)`,
    )
    .run(
      id,
      options.sourceSystem ?? 'telestaff',
      options.sourceHash ?? 'a'.repeat(64),
      options.parserVersion ?? 'telestaff-assignments-html@1',
      options.sourceKind ?? 'official',
      inputRowCount,
      normalizedDataRowCount,
      uniqueEmployeeCount,
      reportRowCount,
      structuralRowCount,
      options.sourceSnapshotAsOf ?? null,
      NOW,
    );
  sqlite
    .prepare(
      `INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          normalized_source_topology, source_topology_completeness, disposition,
          reconciliation_classification, review_status, resolution_action,
          reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
       VALUES (?, ?, 1, ?, ?, ?, 'incomplete', 'ambiguous_mapping',
         'INCOMPLETE_TOPOLOGY', 'approved', 'RETAIN_UNMATERIALIZED_SOURCE_ROW',
         ?, 1, 'Synthetic source evidence retained without capacity materialization.', ?)`,
    )
    .run(
      `${id}-row`,
      id,
      'b'.repeat(64),
      'c'.repeat(64),
      options.topology ??
        '{"v":1,"shift":"A","division":"Suppression","station":"HQ","unit":null,"position":null}',
      NOW,
      NOW,
    );
}

function appendSourceRow(
  sqlite: Database.Database,
  id: string,
  options: { fingerprint: string; memberReferenceHmac: string; sourceRowNumber: number },
): void {
  sqlite
    .prepare(
      `INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          normalized_source_topology, source_topology_completeness, disposition,
          reconciliation_classification, review_status, resolution_action,
          reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
       VALUES (?, ?, ?, ?, ?,
         '{"v":1,"shift":"A","division":"Suppression","station":"HQ","unit":null,"position":null}',
         'incomplete', 'ambiguous_mapping', 'INCOMPLETE_TOPOLOGY', 'approved',
         'RETAIN_UNMATERIALIZED_SOURCE_ROW', ?, 1,
         'Synthetic source evidence retained without capacity materialization.', ?)`,
    )
    .run(
      `${id}-row-${options.sourceRowNumber}-${options.fingerprint.slice(0, 4)}`,
      id,
      options.sourceRowNumber,
      options.fingerprint,
      options.memberReferenceHmac,
      NOW,
      NOW,
    );
}

function commit(sqlite: Database.Database, id: string): void {
  sqlite.prepare("UPDATE assignment_imports SET status = 'reviewed' WHERE id = ?").run(id);
  sqlite
    .prepare(
      "UPDATE assignment_imports SET status = 'approved', approved_at = ?, approved_by_member_id = 1 WHERE id = ?",
    )
    .run(NOW, id);
  sqlite
    .prepare("UPDATE assignment_imports SET status = 'committed', committed_at = ? WHERE id = ?")
    .run(NOW, id);
}

function accept(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO bid_year_staffing_baselines
         (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
          acceptance_reason, created_at)
       VALUES (?, 2027, ?, 'accepted', ?, 1, 'Synthetic equivalence proof.', ?)`,
    )
    .run(`${id}-baseline`, id, NOW, NOW);
}

describe('migration 0037 staffing baseline trigger decomposition equivalence', () => {
  it('replaces the single oversized trigger with the four fail-closed guards', () => {
    const sqlite = new Database(':memory:');
    applyMigrations(sqlite);
    const triggers = sqlite
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'bid_year_staffing_baselines' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(triggers).not.toContain(
      'bid_year_staffing_baselines_insert_requires_complete_official_manifest',
    );
    expect(triggers).toEqual(
      expect.arrayContaining([
        'bid_year_staffing_baselines_requires_official_committed_source',
        'bid_year_staffing_baselines_requires_valid_manifest_metadata',
        'bid_year_staffing_baselines_requires_complete_source_row_accounting',
        'bid_year_staffing_baselines_requires_nonblank_source_topology',
      ]),
    );
    sqlite.close();
  });

  it.each([
    ['wrong source system', { sourceSystem: 'other' }],
    ['not committed', {}],
    ['synthetic source', { sourceKind: 'synthetic_test' }],
    ['blank parser provenance', { parserVersion: '\u00a0' }],
    ['malformed source hash', { sourceHash: 'not-a-sha256' }],
    ['mismatched manifest counts', { reportRowCount: 2 }],
    ['normalized data count mismatch', { inputRowCount: 2, normalizedDataRowCount: 1 }],
    ['unique employee count mismatch', { inputRowCount: 2, uniqueEmployeeCount: 1 }],
    ['negative structural row count', { structuralRowCount: -1 }],
    ['malformed snapshot date', { sourceSnapshotAsOf: '2026-02-3x' }],
    ['missing source row accounting', { inputRowCount: 2 }],
    ['blank source topology', { topology: '\u00a0' }],
  ] satisfies ReadonlyArray<readonly [string, ImportFixtureOptions]>)(
    'keeps %s fail-closed from source intake through the annual baseline boundary',
    (_name, options) => {
      const sqlite = new Database(':memory:');
      sqlite.pragma('foreign_keys = ON');
      applyMigrations(sqlite);
      insertActorAndYear(sqlite);
      const id = `equivalence-${_name.replaceAll(' ', '-')}`;
      expect(() => {
        insertCompleteImport(sqlite, id, options);
        if (_name !== 'not committed') {
          commit(sqlite, id);
        }
        accept(sqlite, id);
      }).toThrow();
      sqlite.close();
    },
  );

  it('keeps each source-row accounting predicate fail-closed after decomposition', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    insertActorAndYear(sqlite);

    insertCompleteImport(sqlite, 'duplicate-source-row', { inputRowCount: 2 });
    expect(() =>
      appendSourceRow(sqlite, 'duplicate-source-row', {
        sourceRowNumber: 1,
        fingerprint: 'd'.repeat(64),
        memberReferenceHmac: 'e'.repeat(64),
      }),
    ).toThrow();

    // These predate 0037 and remain the earlier, fail-closed enforcement
    // point for duplicate source-row and opaque source-identity evidence.
    insertCompleteImport(sqlite, 'duplicate-fingerprint', { inputRowCount: 2 });
    expect(() =>
      appendSourceRow(sqlite, 'duplicate-fingerprint', {
        sourceRowNumber: 2,
        fingerprint: 'b'.repeat(64),
        memberReferenceHmac: 'e'.repeat(64),
      }),
    ).toThrow();

    insertCompleteImport(sqlite, 'duplicate-member-reference', { inputRowCount: 2 });
    expect(() =>
      appendSourceRow(sqlite, 'duplicate-member-reference', {
        sourceRowNumber: 2,
        fingerprint: 'd'.repeat(64),
        memberReferenceHmac: 'c'.repeat(64),
      }),
    ).toThrow();
    sqlite.close();
  });

  it('retains the previously separate terminal-review and single-year fail-closed boundaries', () => {
    // These guards were intentionally not moved by 0037; their detailed cases
    // remain covered by schema-0024 reconciliation and schema-0026 baseline tests.
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite);
    insertActorAndYear(sqlite);
    insertCompleteImport(sqlite, 'accepted-equivalence');
    commit(sqlite, 'accepted-equivalence');
    expect(() => accept(sqlite, 'accepted-equivalence')).not.toThrow();
    expect(() => accept(sqlite, 'accepted-equivalence')).toThrow();
    sqlite.close();
  });
});
