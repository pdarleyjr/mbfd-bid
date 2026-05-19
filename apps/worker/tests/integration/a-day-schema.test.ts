import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

function seedYearAndSession(h: TestD1, sessionId: string): void {
  h.sqlite
    .prepare(
      `INSERT OR IGNORE INTO bid_years (year, status, position_template_version,
         rule_book_version, config_json) VALUES (2026, 'open', NULL, NULL, NULL)`,
    )
    .run();
  h.sqlite
    .prepare(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase,
         turn_timer_seconds, expected_duration_days, day_count, config_json)
       VALUES (?, 2026, 0, 'a_day_bid', 180, 2, 0, '{}')`,
    )
    .run(sessionId);
}

function seedMember(h: TestD1, id: number, employeeId: string): void {
  h.sqlite
    .prepare(
      `INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category,
         rsc_seniority, rank_seniority, is_probationary, created_at, updated_at)
       VALUES (?, ?, 'F', 'L', 'FF', 'FF', ?, ?, 0, 0, 0)`,
    )
    .run(id, employeeId, id, id);
}

describe('a_day_picks schema (Plan 07 Task 9)', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('table exists with expected columns', () => {
    const rows = h.sqlite.prepare('PRAGMA table_info(a_day_picks)').all() as Array<{
      name: string;
    }>;
    const cols = rows.map((r) => r.name);
    expect(cols).toContain('id');
    expect(cols).toContain('bid_session_id');
    expect(cols).toContain('member_id');
    expect(cols).toContain('shift');
    expect(cols).toContain('a_day');
    expect(cols).toContain('picked_at');
    expect(cols).toContain('forced');
    expect(cols).toContain('admin_actor_id');
    expect(cols).toContain('reason');
    expect(cols).toContain('idempotency_key');
  });

  it('unique constraint on (bid_session_id, member_id)', () => {
    seedYearAndSession(h, 'sess-test-1');
    seedMember(h, 1, 'E1');

    h.sqlite
      .prepare(
        `INSERT INTO a_day_picks (id, bid_session_id, member_id, shift, a_day, picked_at,
           forced, admin_actor_id, reason, idempotency_key)
         VALUES ('rd-1', 'sess-test-1', 1, 'A', 'G1', 1, 0, NULL, NULL, 'k1')`,
      )
      .run();
    expect(() =>
      h.sqlite
        .prepare(
          `INSERT INTO a_day_picks (id, bid_session_id, member_id, shift, a_day, picked_at,
             forced, admin_actor_id, reason, idempotency_key)
           VALUES ('rd-2', 'sess-test-1', 1, 'A', 'G2', 2, 0, NULL, NULL, 'k2')`,
        )
        .run(),
    ).toThrow();
  });

  it('unique constraint on idempotency_key', () => {
    seedYearAndSession(h, 'sess-other');
    seedMember(h, 10, 'E10');
    seedMember(h, 11, 'E11');

    h.sqlite
      .prepare(
        `INSERT INTO a_day_picks (id, bid_session_id, member_id, shift, a_day, picked_at,
           forced, admin_actor_id, reason, idempotency_key)
         VALUES ('rd-3', 'sess-other', 10, 'B', 'G1', 1, 0, NULL, NULL, 'idem-dup')`,
      )
      .run();
    expect(() =>
      h.sqlite
        .prepare(
          `INSERT INTO a_day_picks (id, bid_session_id, member_id, shift, a_day, picked_at,
             forced, admin_actor_id, reason, idempotency_key)
           VALUES ('rd-4', 'sess-other', 11, 'B', 'G2', 2, 0, NULL, NULL, 'idem-dup')`,
        )
        .run(),
    ).toThrow();
  });

  it('current_phase accepts a_day_bid value', () => {
    seedYearAndSession(h, 'sess-phase');
    h.sqlite
      .prepare(`UPDATE bid_sessions SET current_phase = 'a_day_bid' WHERE id = 'sess-phase'`)
      .run();
    const row = h.sqlite
      .prepare(`SELECT current_phase FROM bid_sessions WHERE id = 'sess-phase'`)
      .get() as { current_phase: string };
    expect(row.current_phase).toBe('a_day_bid');
  });
});
