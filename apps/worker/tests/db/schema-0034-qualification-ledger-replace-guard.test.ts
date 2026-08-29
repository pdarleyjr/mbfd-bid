import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

type QualificationEventRow = Record<string, unknown>;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function applyMigrationsThrough(sqlite: Database.Database, lastMigration: string): void {
  for (const file of migrationFiles()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
    if (file === lastMigration) {
      return;
    }
  }
  throw new Error(`Migration not found: ${lastMigration}`);
}

function applyRemainingMigrations(sqlite: Database.Database, afterMigration: string): void {
  let reachedBoundary = false;
  for (const file of migrationFiles()) {
    if (reachedBoundary) {
      sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
    }
    if (file === afterMigration) {
      reachedBoundary = true;
    }
  }
  if (!reachedBoundary) {
    throw new Error(`Migration not found: ${afterMigration}`);
  }
}

function seedMember(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'synthetic-ledger-guard-001', 'Synthetic', 'Ledger', 'FF', 'FF', 1, 0, 1, 1)`,
    )
    .run();
}

function insertLegacySpecialtyRow(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, kind, effective_on, expires_on,
          evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
          before_state, after_state, created_at)
       VALUES
         ('legacy-specialty-qualification', 1, NULL, 'SYNTHETIC_RESCUE', 'SPECIALTY_QUALIFIED',
          '2026-08-01', NULL, 'synthetic-ledger-fixture', 'legacy-source-ref',
          'Synthetic legacy specialty evidence.', 'synthetic-admin', 'legacy-specialty-idem',
          '{"active":false}', '{"active":true}', 1722513600000)`,
    )
    .run();
}

function qualificationEvent(sqlite: Database.Database, id: string): QualificationEventRow {
  const row = sqlite.prepare('SELECT * FROM member_qualification_events WHERE id = ?').get(id) as
    | QualificationEventRow
    | undefined;
  if (row === undefined) {
    throw new Error(`Qualification event not found: ${id}`);
  }
  return row;
}

function replaceLegacyRowById(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES
         ('legacy-specialty-qualification', 1, NULL, 'SYNTHETIC_RESCUE', NULL,
          'SPECIALTY_QUALIFIED', '2026-08-02', NULL, 'synthetic-ledger-fixture',
          'attempted-replacement', 'Attempted immutable-row replacement.', 'synthetic-admin',
          'replacement-by-id-idem', '{"active":true}', '{"active":true}', 1722600000000)`,
    )
    .run();
}

function replaceLegacyRowByIdempotencyKey(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES
         ('replacement-by-idempotency-key', 1, NULL, 'SYNTHETIC_RESCUE', NULL,
          'SPECIALTY_QUALIFIED', '2026-08-02', NULL, 'synthetic-ledger-fixture',
          'attempted-replacement', 'Attempted immutable-row replacement.', 'synthetic-admin',
          'legacy-specialty-idem', '{"active":true}', '{"active":true}', 1722600000000)`,
    )
    .run();
}

describe('qualification lifecycle ledger replacement guard (migration 0034)', () => {
  it('uses a forward-only trigger rather than rebuilding the immutable ledger', () => {
    const migration = readFileSync(
      resolve(MIGRATIONS_DIR, '0034_qualification_ledger_replace_guard.sql'),
      'utf-8',
    );

    expect(migration).toMatch(/CREATE\s+TRIGGER/i);
    expect(migration).not.toMatch(/DROP\s+TABLE|CREATE\s+TABLE\s+member_qualification_events/i);
  });

  it('rejects REPLACE collisions before deletion with recursive triggers disabled across the full chain', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('recursive_triggers = OFF');
    applyMigrationsThrough(sqlite, '0034_qualification_ledger_replace_guard.sql');
    seedMember(sqlite);
    insertLegacySpecialtyRow(sqlite);

    expect(sqlite.pragma('recursive_triggers', { simple: true })).toBe(0);
    const original = qualificationEvent(sqlite, 'legacy-specialty-qualification');

    expect(() => replaceLegacyRowById(sqlite)).toThrow(/immutable.*replace|replace.*immutable/i);
    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toEqual(original);

    expect(() => replaceLegacyRowByIdempotencyKey(sqlite)).toThrow(
      /immutable.*replace|replace.*immutable/i,
    );
    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toEqual(original);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM member_qualification_events WHERE id = 'replacement-by-idempotency-key'",
        )
        .get(),
    ).toEqual({ count: 0 });

    sqlite.close();
  });

  it('keeps UPDATE, UPSERT UPDATE, and DELETE blocked while accepting a fresh valid terminal event', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('recursive_triggers = OFF');
    applyMigrationsThrough(sqlite, '0034_qualification_ledger_replace_guard.sql');
    seedMember(sqlite);
    insertLegacySpecialtyRow(sqlite);
    const original = qualificationEvent(sqlite, 'legacy-specialty-qualification');

    expect(() =>
      sqlite
        .prepare(
          "UPDATE member_qualification_events SET reason = 'Tampered immutable row.' WHERE id = ?",
        )
        .run('legacy-specialty-qualification'),
    ).toThrow(/immutable/i);
    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toEqual(original);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO member_qualification_events
             (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
              effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
              idempotency_key, before_state, after_state, created_at)
           VALUES
             ('upsert-attempt', 1, NULL, 'SYNTHETIC_RESCUE', NULL, 'SPECIALTY_QUALIFIED',
              '2026-08-02', NULL, 'synthetic-ledger-fixture', NULL,
              'Attempted immutable-row UPSERT.', 'synthetic-admin', 'legacy-specialty-idem',
              '{"active":true}', '{"active":true}', 1722600000000)
           ON CONFLICT(idempotency_key) DO UPDATE SET reason = excluded.reason`,
        )
        .run(),
    ).toThrow(/immutable/i);
    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toEqual(original);
    expect(() =>
      sqlite
        .prepare('DELETE FROM member_qualification_events WHERE id = ?')
        .run('legacy-specialty-qualification'),
    ).toThrow(/cannot be deleted/i);
    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toEqual(original);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO member_qualification_events
             (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
              effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
              idempotency_key, before_state, after_state, created_at)
           VALUES
             ('fresh-specialty-revocation', 1, NULL, 'SYNTHETIC_RESCUE', 'REVOKED',
              'SPECIALTY_QUALIFIED', '2026-08-03', NULL, 'synthetic-ledger-fixture', NULL,
              'Synthetic fresh terminal evidence.', 'synthetic-admin', 'fresh-specialty-revocation-idem',
              '{"active":true}', '{"active":false}', 1722686400000)`,
        )
        .run(),
    ).not.toThrow();
    expect(qualificationEvent(sqlite, 'fresh-specialty-revocation')).toMatchObject({
      id: 'fresh-specialty-revocation',
      specialty_terminal_status: 'REVOKED',
      kind: 'SPECIALTY_QUALIFIED',
    });

    sqlite.close();
  });

  it('preserves an upgrade-like pre-0033 specialty row and protects it after 0033 and 0034', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('recursive_triggers = OFF');
    applyMigrationsThrough(sqlite, '0032_qualification_lifecycle.sql');
    seedMember(sqlite);
    insertLegacySpecialtyRow(sqlite);
    const originalBeforeUpgrade = qualificationEvent(sqlite, 'legacy-specialty-qualification');

    applyRemainingMigrations(sqlite, '0032_qualification_lifecycle.sql');

    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toMatchObject({
      ...originalBeforeUpgrade,
      specialty_terminal_status: null,
    });
    const originalAfterUpgrade = qualificationEvent(sqlite, 'legacy-specialty-qualification');

    expect(() => replaceLegacyRowById(sqlite)).toThrow(/immutable.*replace|replace.*immutable/i);
    expect(qualificationEvent(sqlite, 'legacy-specialty-qualification')).toEqual(
      originalAfterUpgrade,
    );

    sqlite.close();
  });
});
