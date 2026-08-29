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

function insertMember(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'synthetic-member', 'Synthetic', 'Member', 'FF', 'FF', 1, 0, ?, ?)`,
    )
    .run(NOW, NOW);
}

describe('personnel lifecycle schema (migration 0027)', () => {
  it('exports the canonical member employment projection and immutable lifecycle ledger', () => {
    expect(Object.hasOwn(schema.members, 'employmentStatus')).toBe(true);
    expect(Object.hasOwn(schema.members, 'employmentStatusEffectiveOn')).toBe(true);
    expect(Object.hasOwn(schema.members, 'separationType')).toBe(true);
    expect((schema as Record<string, unknown>).personnelLifecycleEvents).toBeDefined();
  });

  it('defaults legacy members to unknown and retains an immutable, validated lifecycle event', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    insertMember(sqlite);

    expect(sqlite.prepare('SELECT employment_status FROM members WHERE id = 1').get()).toEqual({
      employment_status: 'unknown',
    });

    sqlite
      .prepare(
        `INSERT INTO personnel_lifecycle_events
           (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
            employment_status_before, employment_status_after, rank_before, rank_after,
            separation_type, reason, origin, actor_subject, idempotency_key,
            before_state, after_state, supersedes_event_id, created_at)
         VALUES
           ('new-hire-1', 1, NULL, NULL, 'NEW_HIRE', '2026-08-28',
            'unknown', 'active', NULL, 'FF', NULL, 'Synthetic new hire.', 'ADMIN',
            'synthetic-admin', 'synthetic-new-hire-1', '{"employmentStatus":"unknown"}',
            '{"employmentStatus":"active","rank":"FF"}', NULL, ?)`,
      )
      .run(NOW);

    expect(() =>
      sqlite
        .prepare(
          "UPDATE personnel_lifecycle_events SET reason = 'rewritten' WHERE id = 'new-hire-1'",
        )
        .run(),
    ).toThrow();
    expect(() =>
      sqlite.prepare("DELETE FROM personnel_lifecycle_events WHERE id = 'new-hire-1'").run(),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO personnel_lifecycle_events
             (id, member_id, kind, effective_on, reason, origin, actor_subject, idempotency_key,
              before_state, after_state, created_at)
           VALUES ('invalid-status', 1, 'NEW_HIRE', '2026-08-28', 'Invalid status.', 'ADMIN',
             'synthetic-admin', 'synthetic-invalid-status', '{"employmentStatus":"bogus"}',
             '{"employmentStatus":"active"}', ?)`,
        )
        .run(NOW),
    ).toThrow();

    sqlite.close();
  });
});
