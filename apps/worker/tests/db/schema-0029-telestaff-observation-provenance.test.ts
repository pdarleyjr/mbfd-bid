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

function insertImport(
  sqlite: Database.Database,
  id: string,
  sourceObservedAt: number | null,
  basis: 'date_only' | 'source_metadata' | 'administrator_confirmed',
): void {
  sqlite
    .prepare(
      `INSERT INTO assignment_imports
         (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
          input_row_count, normalized_data_row_count, unique_employee_count, report_row_count,
          structural_row_count, source_snapshot_as_of, source_observed_at,
          source_observation_time_basis, status, created_at)
       VALUES (?, 'telestaff', 'synthetic-v1', ?, 'TELSTAFF_ASSIGNMENTS_HTML_V1',
          'telestaff-assignments-html@1', 'official', 1, 1, 1, 1, 0, '2026-08-28', ?, ?,
          'staged', ?)`,
    )
    .run(id, 'a'.repeat(64), sourceObservedAt, basis, NOW);
}

describe('TeleStaff source-observation provenance (migration 0029)', () => {
  it('exports distinct source observation provenance fields', () => {
    expect(Object.hasOwn(schema.assignmentImports, 'sourceObservedAt')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImports, 'sourceObservationTimeBasis')).toBe(true);
    expect(Object.hasOwn(schema.assignmentObservations, 'sourceObservedAt')).toBe(true);
  });

  it('retains an exact source time only with an explicit trustworthy basis and permits date-only evidence without fabricating a time', () => {
    const sqlite = new Database(':memory:');
    applyMigrationsStrict(sqlite);

    insertImport(sqlite, 'import-source-metadata', NOW, 'source_metadata');
    insertImport(sqlite, 'import-date-only', null, 'date_only');
    expect(() => insertImport(sqlite, 'import-invalid-basis', NOW, 'date_only')).toThrow();
    expect(() =>
      insertImport(sqlite, 'import-missing-time', null, 'administrator_confirmed'),
    ).toThrow();

    const rows = sqlite
      .prepare(
        `SELECT id, source_observed_at, source_observation_time_basis
         FROM assignment_imports ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      {
        id: 'import-date-only',
        source_observed_at: null,
        source_observation_time_basis: 'date_only',
      },
      {
        id: 'import-source-metadata',
        source_observed_at: NOW,
        source_observation_time_basis: 'source_metadata',
      },
    ]);
    sqlite.close();
  });
});
