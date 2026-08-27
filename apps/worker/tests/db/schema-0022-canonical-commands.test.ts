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

function seedMockSession(sqlite: Database.Database, sessionId = 'mock-session-0022'): void {
  sqlite.prepare('INSERT INTO bid_years (year, status) VALUES (?, ?)').run(2030, 'configuring');
  sqlite
    .prepare(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, 2030, 1, 'config', 180, 2, 0, 1);
}

describe('canonical command/outbox schema (migration 0022)', () => {
  it('exports separate authoritative state, receipt, event, and archive-outbox tables', () => {
    expect(schema.canonicalBidSessionState).toBeDefined();
    expect(schema.bidCommandReceipts).toBeDefined();
    expect(schema.bidCommandEvents).toBeDefined();
    expect(schema.bidAuditOutbox).toBeDefined();
  });

  it('binds the canonical JSON projection to its session identity and durable sequence', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite);

    const insert = sqlite.prepare(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 1, 1)`,
    );

    expect(() =>
      insert.run('mock-session-0022', 0, '{"bidSessionId":"another-session","lastSeq":0}'),
    ).toThrow(/check constraint/i);
    expect(() =>
      insert.run('mock-session-0022', 0, '{"bidSessionId":"mock-session-0022","lastSeq":1}'),
    ).toThrow(/check constraint/i);
  });

  it('is append-only for accepted command evidence while allowing delivery retry state to progress', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite);

    const requestHash = 'a'.repeat(64);
    const payloadHash = 'b'.repeat(64);
    sqlite
      .prepare(
        `INSERT INTO canonical_bid_session_state (
          bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'mock-session-0022',
        1,
        '{"bidSessionId":"mock-session-0022","lastSeq":1,"currentPhase":"paused"}',
        'cmd-0022',
        10,
        10,
      );
    sqlite
      .prepare(
        `INSERT INTO bid_command_receipts (
          command_id, bid_session_id, command_type, request_sha256, actor_id,
          expected_seq, result_seq, outcome, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'cmd-0022',
        'mock-session-0022',
        'mock.freeze',
        requestHash,
        0,
        0,
        1,
        'accepted',
        '{"kind":"accepted"}',
        10,
      );
    sqlite
      .prepare(
        `INSERT INTO audit_log (
          id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'audit-0022',
        'mock-session-0022',
        1,
        'admin',
        0,
        'pause',
        'session',
        'mock-session-0022',
        null,
        '{"frozen":true}',
        'freeze: rehearsal',
        null,
        null,
        10,
      );
    sqlite
      .prepare(
        `INSERT INTO bid_command_events (
          id, bid_session_id, command_id, audit_log_id, seq, event_type, event_json, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'event-0022',
        'mock-session-0022',
        'cmd-0022',
        'audit-0022',
        1,
        'freeze',
        '{"v":1}',
        0,
        10,
      );
    sqlite
      .prepare(
        `INSERT INTO bid_audit_outbox (
          id, bid_session_id, command_id, event_id, archive_key, payload_json, payload_sha256,
          status, attempts, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'outbox-0022',
        'mock-session-0022',
        'cmd-0022',
        'event-0022',
        'canonical-audit/mock-session-0022/1.json',
        '{"v":1}',
        payloadHash,
        'pending',
        0,
        10,
        10,
        10,
      );

    expect(() =>
      sqlite
        .prepare('UPDATE bid_audit_outbox SET archived_at = ? WHERE id = ?')
        .run(11, 'outbox-0022'),
    ).toThrow(/archived_at/i);

    expect(() =>
      sqlite
        .prepare('UPDATE bid_command_events SET event_json = ? WHERE id = ?')
        .run('{"tampered":true}', 'event-0022'),
    ).toThrow(/immutable/i);
    expect(() =>
      sqlite.prepare('DELETE FROM bid_command_receipts WHERE command_id = ?').run('cmd-0022'),
    ).toThrow(/immutable/i);
    expect(() =>
      sqlite
        .prepare('UPDATE bid_audit_outbox SET payload_json = ? WHERE id = ?')
        .run('{"tampered":true}', 'outbox-0022'),
    ).toThrow(/immutable/i);
    sqlite
      .prepare('UPDATE audit_log SET chunk_seq = ?, chunk_row_index = ? WHERE id = ?')
      .run(7, 0, 'audit-0022');
    expect(
      sqlite
        .prepare('SELECT chunk_seq, chunk_row_index FROM audit_log WHERE id = ?')
        .get('audit-0022'),
    ).toEqual({ chunk_seq: 7, chunk_row_index: 0 });
    expect(() =>
      sqlite.prepare('UPDATE audit_log SET reason = ? WHERE id = ?').run('tampered', 'audit-0022'),
    ).toThrow(/immutable/i);
    expect(() =>
      sqlite
        .prepare('UPDATE audit_log SET chunk_seq = ?, chunk_row_index = ? WHERE id = ?')
        .run(8, 0, 'audit-0022'),
    ).toThrow(/immutable/i);

    sqlite
      .prepare(
        `UPDATE bid_audit_outbox
         SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run('retry', 1, 20, 'simulated archive outage', 20, 'outbox-0022');
    expect(
      sqlite
        .prepare('SELECT status, attempts, last_error FROM bid_audit_outbox WHERE id = ?')
        .get('outbox-0022'),
    ).toEqual({ status: 'retry', attempts: 1, last_error: 'simulated archive outage' });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects an accepted receipt unless the state update identifies that exact command and sequence', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, 'state-guard-0022');
    sqlite
      .prepare(
        `INSERT INTO canonical_bid_session_state (
          bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'state-guard-0022',
        0,
        '{"bidSessionId":"state-guard-0022","lastSeq":0,"currentPhase":"position_bid"}',
        null,
        1,
        1,
      );

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO bid_command_receipts (
            command_id, bid_session_id, command_type, request_sha256, actor_id,
            expected_seq, result_seq, outcome, result_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'unbound-command-0022',
          'state-guard-0022',
          'mock.freeze',
          'c'.repeat(64),
          0,
          0,
          1,
          'accepted',
          '{"kind":"accepted"}',
          1,
        ),
    ).toThrow(/state/i);
  });

  it('requires an accepted receipt to advance exactly one expected sequence', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, 'receipt-sequence-0022');
    sqlite
      .prepare(
        `INSERT INTO canonical_bid_session_state (
          bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'receipt-sequence-0022',
        2,
        '{"bidSessionId":"receipt-sequence-0022","lastSeq":2}',
        'receipt-sequence-bad',
        1,
        1,
      );

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO bid_command_receipts (
            command_id, bid_session_id, command_type, request_sha256, actor_id,
            expected_seq, result_seq, outcome, result_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'receipt-sequence-bad',
          'receipt-sequence-0022',
          'mock.freeze',
          'd'.repeat(64),
          7,
          0,
          2,
          'accepted',
          '{"kind":"accepted"}',
          1,
        ),
    ).toThrow(/result_seq\s*=\s*expected_seq/i);
  });

  it('requires a canonical event to bind an audit row for the same session and actor', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, 'audit-binding-0022');
    sqlite
      .prepare(
        `INSERT INTO canonical_bid_session_state (
          bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'audit-binding-0022',
        1,
        '{"bidSessionId":"audit-binding-0022","lastSeq":1}',
        'audit-binding-command',
        1,
        1,
      );
    sqlite
      .prepare(
        `INSERT INTO bid_command_receipts (
          command_id, bid_session_id, command_type, request_sha256, actor_id,
          expected_seq, result_seq, outcome, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'audit-binding-command',
        'audit-binding-0022',
        'mock.freeze',
        'e'.repeat(64),
        7,
        0,
        1,
        'accepted',
        '{"kind":"accepted"}',
        1,
      );
    sqlite
      .prepare(
        `INSERT INTO audit_log (
          id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'audit-binding-row',
        'audit-binding-0022',
        2,
        'admin',
        99,
        'pause',
        'session',
        'audit-binding-0022',
        null,
        '{"frozen":true}',
        'wrong audit binding',
        null,
        null,
        1,
      );

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO bid_command_events (
            id, bid_session_id, command_id, audit_log_id, seq, event_type, event_json, actor_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'audit-binding-event',
          'audit-binding-0022',
          'audit-binding-command',
          'audit-binding-row',
          1,
          'freeze',
          '{"v":1}',
          7,
          1,
        ),
    ).toThrow(/audit evidence/i);
  });

  it('requires a pristine legacy mock before the first canonical state is seeded', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, 'legacy-seed-0022');
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(77, '770077', 'Canonical', 'Member', 'FF', 'FF', 1, 0, 1, 1);
    sqlite
      .prepare(
        `INSERT INTO bids
         (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-bid-seed-0022',
        'legacy-seed-0022',
        1,
        77,
        'A101',
        1,
        0,
        'legacy-bid-seed-0022',
        'pending',
        0,
      );

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO canonical_bid_session_state
           (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
           VALUES (?, 0, ?, NULL, 1, 1)`,
        )
        .run('legacy-seed-0022', '{"bidSessionId":"legacy-seed-0022","lastSeq":0}'),
    ).toThrow(/pristine.*legacy/i);

    sqlite
      .prepare(
        `INSERT INTO bid_sessions
         (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
         VALUES (?, 2030, 1, 'position_bid', 180, 2, 0, 1)`,
      )
      .run('legacy-a-day-seed-0022');
    sqlite
      .prepare(
        `INSERT INTO a_day_picks
         (id, bid_session_id, member_id, shift, a_day, picked_at, forced, idempotency_key)
         VALUES (?, ?, ?, 'A', 'G1', 1, 0, ?)`,
      )
      .run('legacy-a-day-seed-0022', 'legacy-a-day-seed-0022', 77, 'legacy-a-day-seed-0022');

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO canonical_bid_session_state
           (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
           VALUES (?, 0, ?, NULL, 1, 1)`,
        )
        .run('legacy-a-day-seed-0022', '{"bidSessionId":"legacy-a-day-seed-0022","lastSeq":0}'),
    ).toThrow(/pristine.*legacy/i);

    sqlite
      .prepare(
        `INSERT INTO bid_sessions
         (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
         VALUES (?, 2030, 1, 'config', 180, 2, 0, 0)`,
      )
      .run('live-seed-0022');
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO canonical_bid_session_state
           (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
           VALUES (?, 0, ?, NULL, 1, 1)`,
        )
        .run('live-seed-0022', '{"bidSessionId":"live-seed-0022","lastSeq":0}'),
    ).toThrow(/mock/i);
  });

  it('locks legacy bid and session-state mutations once canonical state exists', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, 'legacy-lock-0022');
    sqlite
      .prepare(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(77, '770077', 'Canonical', 'Member', 'FF', 'FF', 1, 0, 1, 1);
    sqlite
      .prepare(
        `INSERT INTO canonical_bid_session_state
         (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
         VALUES (?, 0, ?, NULL, 1, 1)`,
      )
      .run(
        'legacy-lock-0022',
        '{"bidSessionId":"legacy-lock-0022","lastSeq":0,"currentPhase":"paused"}',
      );

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO bids
           (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'legacy-bid-0022',
          'legacy-lock-0022',
          1,
          77,
          'A101',
          1,
          0,
          'legacy-bid-0022',
          'pending',
          0,
        ),
    ).toThrow(/canonical.*command/i);
    expect(() =>
      sqlite
        .prepare('UPDATE bid_sessions SET current_phase = ? WHERE id = ?')
        .run('paused', 'legacy-lock-0022'),
    ).toThrow(/canonical.*command/i);
    expect(() =>
      sqlite
        .prepare('UPDATE bid_sessions SET turn_timer_seconds = ? WHERE id = ?')
        .run(240, 'legacy-lock-0022'),
    ).toThrow(/canonical.*command/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO a_day_picks
           (id, bid_session_id, member_id, shift, a_day, picked_at, forced, idempotency_key)
           VALUES (?, ?, ?, 'A', 'G1', 1, 0, ?)`,
        )
        .run('legacy-a-day-lock-0022', 'legacy-lock-0022', 77, 'legacy-a-day-lock-0022'),
    ).toThrow(/canonical.*command/i);

    sqlite
      .prepare(
        `INSERT INTO bid_sessions
         (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
         VALUES (?, 2030, 1, 'position_bid', 180, 2, 0, 1)`,
      )
      .run('legacy-source-0022');
    sqlite
      .prepare(
        `INSERT INTO bids
         (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-move-0022',
        'legacy-source-0022',
        1,
        77,
        'A101',
        1,
        0,
        'legacy-move-0022',
        'pending',
        0,
      );
    expect(() =>
      sqlite
        .prepare('UPDATE bids SET bid_session_id = ? WHERE id = ?')
        .run('legacy-lock-0022', 'legacy-move-0022'),
    ).toThrow(/canonical.*command/i);
  });
});
