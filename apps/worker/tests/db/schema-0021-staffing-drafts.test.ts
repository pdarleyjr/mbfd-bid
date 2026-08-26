import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

function applyMigrationsStrict(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
    const statements = sql
      .split('--> statement-breakpoint')
      .flatMap((chunk) => chunk.split(';'))
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      sqlite.exec(`${statement};`);
    }
  }
}

describe('V2 staffing drafts schema (migration 0021)', () => {
  it('exports separate authorized-slot, current-assignment, import, alias, and history tables', () => {
    expect(schema.staffingPositions).toBeDefined();
    expect(schema.memberAssignments).toBeDefined();
    expect(schema.assignmentImports).toBeDefined();
    expect(schema.assignmentImportRows).toBeDefined();
    expect(schema.assignmentAliases).toBeDefined();
    expect(schema.assignmentServiceHistory).toBeDefined();
  });

  it('keeps the staffing source A/R-day field distinct from legacy Bid A-Day semantics', () => {
    expect(Object.hasOwn(schema.staffingPositions, 'aRDay')).toBe(true);
    expect(Object.hasOwn(schema.staffingPositions, 'aDay')).toBe(false);
  });

  it('reserves a keyed opaque member reference instead of a lookup-prone identity hash', () => {
    expect(Object.hasOwn(schema.assignmentImportRows, 'memberReferenceHmac')).toBe(true);
    expect(Object.hasOwn(schema.assignmentImportRows, 'memberReferenceHash')).toBe(false);
  });

  it('applies on a pristine database and keeps staged import rows separate from current assignments', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'staffing_positions',
        'member_assignments',
        'assignment_imports',
        'assignment_import_rows',
        'assignment_aliases',
        'assignment_service_history',
      ]),
    );

    sqlite
      .prepare(
        'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('import-1', 'telestaff', 'sanitized-baseline', 'a'.repeat(64), 'staged', 1);
    sqlite
      .prepare(
        'INSERT INTO assignment_import_rows (id, import_id, source_row_number, row_fingerprint, disposition, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('row-1', 'import-1', 1, 'b'.repeat(64), 'unknown_employee', 1);

    const stagedRows = sqlite
      .prepare('SELECT COUNT(*) AS count FROM assignment_import_rows')
      .get() as { count: number };
    const assignments = sqlite
      .prepare('SELECT COUNT(*) AS count FROM member_assignments')
      .get() as { count: number };
    expect(stagedRows.count).toBe(1);
    expect(assignments.count).toBe(0);
    sqlite.close();
  });

  it('does not allow an import to be marked committed without recorded human approval', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, status, created_at, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'unapproved-commit',
          'telestaff',
          'sanitized-baseline',
          'c'.repeat(64),
          'committed',
          1,
          2,
        ),
    ).toThrow();

    sqlite.close();
  });

  it('requires an approval timestamp as well as an approving member before commit', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, status, created_at, approved_by_member_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'timestampless-commit',
          'telestaff',
          'sanitized-baseline',
          'd'.repeat(64),
          'committed',
          1,
          1,
          2,
        ),
    ).toThrow();

    sqlite.close();
  });

  it('accepts a committed import when both human approval fields are recorded', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, status, created_at, approved_at, approved_by_member_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'approved-commit',
          'telestaff',
          'sanitized-baseline',
          'e'.repeat(64),
          'committed',
          1,
          2,
          1,
          3,
        ),
    ).not.toThrow();

    sqlite.close();
  });

  it('does not allow the recorded approval to occur after a commit', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'synthetic-admin', 'Synthetic', 'Admin', 'Chief', 'Admin', 1, 1, 1);

    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO assignment_imports (id, source_system, source_version, source_hash, status, created_at, approved_at, approved_by_member_id, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'late-approval-commit',
          'telestaff',
          'sanitized-baseline',
          'f'.repeat(64),
          'committed',
          1,
          3,
          1,
          2,
        ),
    ).toThrow();

    sqlite.close();
  });
});
