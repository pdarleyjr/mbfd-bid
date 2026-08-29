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

function seedMember(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'synthetic-specialty-terminal-001', 'Synthetic', 'Specialty', 'FF', 'FF', 1, 0, 1, 1)`,
    )
    .run();
}

describe('specialty terminal lifecycle schema (migration 0033)', () => {
  it('uses an additive terminal discriminator without rebuilding the immutable evidence ledger', () => {
    const migration = readFileSync(
      resolve(MIGRATIONS_DIR, '0033_specialty_terminal_lifecycle.sql'),
      'utf-8',
    );
    expect(migration).toContain('ALTER TABLE member_qualification_events');
    expect(migration).not.toMatch(/DROP\s+TABLE|CREATE\s+TABLE\s+member_qualification_events/i);
    expect(Object.hasOwn(schema.memberQualificationEvents, 'specialtyTerminalStatus')).toBe(true);
  });

  it('preserves immutability while accepting only well-formed specialty terminal rows', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMember(sqlite);

    const insert = sqlite.prepare(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES (?, 1, NULL, 'TECHNICAL_RESCUE', ?, 'SPECIALTY_QUALIFIED',
          '2026-08-01', ?, 'synthetic-specialty-board', NULL, 'Synthetic terminal evidence.',
          'synthetic-admin', ?, '{}', '{}', 1)`,
    );

    expect(() => insert.run('invalid-expiry', 'EXPIRED', null, 'invalid-expiry')).toThrow(
      /invalid specialty terminal lifecycle event/i,
    );
    expect(() => insert.run('valid-revocation', 'REVOKED', null, 'valid-revocation')).not.toThrow();
    expect(
      sqlite
        .prepare(
          "SELECT kind, specialty_terminal_status FROM member_qualification_events WHERE id = 'valid-revocation'",
        )
        .get(),
    ).toEqual({ kind: 'SPECIALTY_QUALIFIED', specialty_terminal_status: 'REVOKED' });
    expect(() =>
      sqlite
        .prepare("UPDATE member_qualification_events SET reason = 'tamper' WHERE id = ?")
        .run('valid-revocation'),
    ).toThrow(/immutable/i);
    sqlite.close();
  });
});
