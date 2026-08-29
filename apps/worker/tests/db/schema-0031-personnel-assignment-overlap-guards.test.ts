import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

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

function insertMember(sqlite: Database.Database, id: number): void {
  sqlite
    .prepare(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
       VALUES (?, ?, 'Synthetic', 'Member', 'FF', 'FF', ?, 0, 'active', '2026-01-01', ?, ?)`,
    )
    .run(id, `synthetic-member-${id}`, id, NOW, NOW);
}

function insertSlot(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', 'approved', ?, ?)`,
    )
    .run(id, `SYNTHETIC/${id}`, NOW, NOW);
}

function insertAssignment(
  sqlite: Database.Database,
  input: {
    id: string;
    memberId: number;
    staffingPositionId: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    status?: 'planned' | 'active';
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       VALUES (?, ?, ?, 'ADMIN_TRANSFER', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.memberId,
      input.staffingPositionId,
      `synthetic-origin-${input.id}`,
      input.status ?? 'planned',
      input.effectiveFrom,
      input.effectiveTo ?? null,
      NOW,
      NOW,
    );
}

function insertLifecycleEvent(
  sqlite: Database.Database,
  input: {
    id: string;
    memberId: number;
    staffingPositionId?: string | null;
    kind: 'PROMOTION' | 'TRANSFER' | 'CORRECTION';
    supersedesEventId?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       VALUES (?, ?, ?, NULL, ?, '2026-09-15', 'active', 'active', 'FF', 'LT', NULL,
          'Synthetic lifecycle evidence.', 'ADMIN', 'synthetic-admin', ?,
          '{"memberId":1,"rank":"FF"}', '{"memberId":1,"rank":"LT"}', ?, ?)`,
    )
    .run(
      input.id,
      input.memberId,
      input.staffingPositionId ?? null,
      input.kind,
      `synthetic-event-${input.id}`,
      input.supersedesEventId ?? null,
      NOW,
    );
}

function setupPersonnelSchema(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrationsStrict(sqlite);
  insertMember(sqlite, 1);
  insertMember(sqlite, 2);
  insertSlot(sqlite, 'slot-a');
  insertSlot(sqlite, 'slot-b');
  insertSlot(sqlite, 'slot-c');
  return sqlite;
}

describe('personnel assignment overlap and correction guards (migration 0031)', () => {
  it('prevents overlapping member and slot ranges while permitting the ordered close-then-create transition', () => {
    const sqlite = setupPersonnelSchema();
    insertAssignment(sqlite, {
      id: 'current-a',
      memberId: 1,
      staffingPositionId: 'slot-a',
      status: 'active',
      effectiveFrom: '2026-01-01',
    });

    sqlite.exec(`
      BEGIN;
      UPDATE member_assignments
      SET effective_to = '2026-09-14', updated_at = ${NOW}
      WHERE id = 'current-a';
      INSERT INTO member_assignments
        (id, member_id, staffing_position_id, origin_type, origin_ref, status,
         effective_from, effective_to, created_at, updated_at)
      VALUES
        ('planned-b', 1, 'slot-b', 'ADMIN_TRANSFER', 'synthetic-origin-planned-b', 'planned',
         '2026-09-15', NULL, ${NOW}, ${NOW});
      COMMIT;
    `);

    expect(
      sqlite
        .prepare('SELECT id, effective_from, effective_to FROM member_assignments ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'current-a', effective_from: '2026-01-01', effective_to: '2026-09-14' },
      { id: 'planned-b', effective_from: '2026-09-15', effective_to: null },
    ]);

    expect(() =>
      insertAssignment(sqlite, {
        id: 'overlap-member',
        memberId: 1,
        staffingPositionId: 'slot-c',
        effectiveFrom: '2026-09-15',
      }),
    ).toThrow(/overlapping authoritative assignment for member/);
    expect(() =>
      insertAssignment(sqlite, {
        id: 'overlap-slot',
        memberId: 2,
        staffingPositionId: 'slot-b',
        effectiveFrom: '2026-09-15',
      }),
    ).toThrow(/overlapping authoritative assignment for canonical slot/);
    expect(() =>
      sqlite
        .prepare("UPDATE member_assignments SET effective_to = '2026-09-20' WHERE id = 'current-a'")
        .run(),
    ).toThrow(/overlapping authoritative assignment for member/);

    sqlite.close();
  });

  it('permits supersession only for a correction with same-member compatible evidence', () => {
    const sqlite = setupPersonnelSchema();
    insertLifecycleEvent(sqlite, {
      id: 'member-one-slot-a',
      memberId: 1,
      staffingPositionId: 'slot-a',
      kind: 'PROMOTION',
    });
    insertLifecycleEvent(sqlite, {
      id: 'member-two-slot-b',
      memberId: 2,
      staffingPositionId: 'slot-b',
      kind: 'PROMOTION',
    });

    expect(() =>
      insertLifecycleEvent(sqlite, {
        id: 'non-correction-supersedes',
        memberId: 1,
        staffingPositionId: 'slot-a',
        kind: 'TRANSFER',
        supersedesEventId: 'member-one-slot-a',
      }),
    ).toThrow(/only a correction may supersede/);
    expect(() =>
      insertLifecycleEvent(sqlite, {
        id: 'cross-member-correction',
        memberId: 1,
        kind: 'CORRECTION',
        supersedesEventId: 'member-two-slot-b',
      }),
    ).toThrow(/same-member compatible/);
    expect(() =>
      insertLifecycleEvent(sqlite, {
        id: 'cross-target-correction',
        memberId: 1,
        staffingPositionId: 'slot-b',
        kind: 'CORRECTION',
        supersedesEventId: 'member-one-slot-a',
      }),
    ).toThrow(/same-member compatible/);
    expect(() =>
      insertLifecycleEvent(sqlite, {
        id: 'compatible-correction',
        memberId: 1,
        staffingPositionId: 'slot-a',
        kind: 'CORRECTION',
        supersedesEventId: 'member-one-slot-a',
      }),
    ).not.toThrow();

    sqlite.close();
  });
});
