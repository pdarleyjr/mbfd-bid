import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const migrationsDirectory = resolve(__dirname, '../../migrations');
const fingerprint = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function migrations(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function applyThrough(sqlite: Database.Database, lastMigration: string): void {
  for (const file of migrations()) {
    sqlite.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
    if (file === lastMigration) return;
  }
  throw new Error(`migration not found: ${lastMigration}`);
}

function seedSession(sqlite: Database.Database): void {
  sqlite.prepare("INSERT INTO bid_years (year, status) VALUES (2099, 'configuring')").run();
  sqlite
    .prepare(
      `INSERT INTO bid_sessions (
         id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days,
         day_count, is_mock
       ) VALUES ('receipt-recovery-0036', 2099, 1, 'config', 180, 2, 0, 1)`,
    )
    .run();
}

function insertReceipt(
  sqlite: Database.Database,
  key: string,
  state: 'pending' | 'completed',
): void {
  if (state === 'pending') {
    sqlite
      .prepare(
        `INSERT INTO mock_rehearsal_command_receipts (
           bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
           expected_mock_control_revision, state, created_at
         ) VALUES ('receipt-recovery-0036', ?, 'manual_pick', 'synthetic-admin', ?, 0, 'pending', 1)`,
      )
      .run(key, fingerprint);
    return;
  }
  sqlite
    .prepare(
      `INSERT INTO mock_rehearsal_command_receipts (
         bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
         expected_mock_control_revision, state, response_status, response_json,
         resulting_mock_control_revision, created_at, completed_at
       ) VALUES ('receipt-recovery-0036', ?, 'manual_pick', 'synthetic-admin', ?, 0,
         'completed', 201, '{"bid_id":"prior"}', 1, 1, 2)`,
    )
    .run(key, fingerprint);
}

describe('mock rehearsal receipt recovery schema (migration 0036)', () => {
  it('preserves 0035 receipt history with an immutable terminal recovery sidecar', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('recursive_triggers = OFF');
    applyThrough(sqlite, '0035_mock_rehearsal_control_receipts.sql');
    seedSession(sqlite);
    insertReceipt(sqlite, 'prior-completed', 'completed');
    insertReceipt(sqlite, 'prior-pending', 'pending');

    sqlite.exec(
      readFileSync(
        resolve(migrationsDirectory, '0036_mock_rehearsal_receipt_recovery.sql'),
        'utf8',
      ),
    );

    expect(
      sqlite
        .prepare(
          `SELECT state, response_status, resulting_mock_control_revision
             FROM mock_rehearsal_command_receipts
            WHERE idempotency_key = 'prior-completed'`,
        )
        .get(),
    ).toEqual({
      state: 'completed',
      response_status: 201,
      resulting_mock_control_revision: 1,
    });
    expect(
      sqlite
        .prepare(
          `SELECT state FROM mock_rehearsal_command_receipts
            WHERE idempotency_key = 'prior-pending'`,
        )
        .get(),
    ).toEqual({ state: 'pending' });

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO mock_rehearsal_command_recovery_outcomes
             (bid_session_id, idempotency_key, outcome, response_status, response_json,
              recovery_reason, recovered_by, recovered_at)
           VALUES ('receipt-recovery-0036', 'prior-pending', 'recovery_required', 409,
             '{"error":"recovery_required"}', 'missing complete audit evidence', 'system_recovery', 3)`,
        )
        .run(),
    ).not.toThrow();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO mock_rehearsal_command_recovery_outcomes
             (bid_session_id, idempotency_key, outcome, response_status, response_json,
              recovery_reason, recovered_by, recovered_at)
           VALUES ('receipt-recovery-0036', 'prior-completed', 'recovery_required', 409,
             '{"error":"recovery_required"}', 'completed receipts are never recoverable', 'system_recovery', 3)`,
        )
        .run(),
    ).toThrow(/requires a pending receipt/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO mock_rehearsal_command_recovery_outcomes
             (bid_session_id, idempotency_key, outcome, response_status, response_json,
              recovery_reason, recovered_by, recovered_at)
           VALUES ('receipt-recovery-0036', 'missing-receipt', 'recovery_required', 409,
             '{"error":"recovery_required"}', 'orphan receipts are never recoverable', 'system_recovery', 3)`,
        )
        .run(),
    ).toThrow(/requires a pending receipt/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO mock_rehearsal_command_recovery_outcomes
             (bid_session_id, idempotency_key, outcome, response_status, response_json,
              recovery_reason, recovered_by, recovered_at)
           VALUES ('receipt-recovery-0036', 'prior-pending', 'unsupported', 409,
             '{"error":"recovery_required"}', 'invalid terminal state', 'system_recovery', 3)`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare(
          `UPDATE mock_rehearsal_command_recovery_outcomes
              SET response_json = '{"error":"tampered"}'
            WHERE idempotency_key = 'prior-pending'`,
        )
        .run(),
    ).toThrow(/completion|immutable/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO mock_rehearsal_command_recovery_outcomes
             (bid_session_id, idempotency_key, outcome, response_status, response_json,
              recovery_reason, recovered_by, recovered_at)
           VALUES ('receipt-recovery-0036', 'prior-pending', 'recovery_required', 409,
             '{"error":"tampered"}', 'tampered', 'system_recovery', 4)`,
        )
        .run(),
    ).toThrow(/cannot be replaced|immutable/i);
    sqlite.close();
  });
});
