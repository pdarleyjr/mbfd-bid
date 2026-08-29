import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

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

function insertBidSession(sqlite: Database.Database, id = 'mock-control-session-0035'): void {
  sqlite.prepare("INSERT INTO bid_years (year, status) VALUES (2099, 'configuring')").run();
  sqlite
    .prepare(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count,
        is_mock
      ) VALUES (?, 2099, 1, 'config', 180, 2, 0, 1)`,
    )
    .run(id);
}

function insertPendingReceipt(
  sqlite: Database.Database,
  sessionId = 'mock-control-session-0035',
): void {
  sqlite
    .prepare(
      `INSERT INTO mock_rehearsal_command_receipts (
        bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
        expected_mock_control_revision, state, created_at
      ) VALUES (?, 'mock-command-0035', 'auto_bid', 'synthetic-admin', ?, 0, 'pending', 1)`,
    )
    .run(sessionId, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
}

describe('mock rehearsal control receipt schema (migration 0035)', () => {
  it('uses an additive session revision and a new receipt table', () => {
    const migration = readFileSync(
      resolve(MIGRATIONS_DIR, '0035_mock_rehearsal_control_receipts.sql'),
      'utf-8',
    );

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+bid_sessions\s+ADD\s+COLUMN\s+mock_control_revision/i,
    );
    expect(migration).toMatch(/CREATE\s+TABLE\s+mock_rehearsal_command_receipts/i);
    expect(migration).not.toMatch(/DROP\s+TABLE|CREATE\s+TABLE\s+bid_sessions/i);
    expect(Object.hasOwn(schema.bidSessions, 'mockControlRevision')).toBe(true);
    expect(Object.hasOwn(schema, 'mockRehearsalCommandReceipts')).toBe(true);
  });

  it('creates nonnegative mock revisions and an immutable, completion-only receipt ledger', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('recursive_triggers = OFF');
    applyMigrationsThrough(sqlite, '0035_mock_rehearsal_control_receipts.sql');
    insertBidSession(sqlite);

    expect(
      sqlite
        .prepare('SELECT mock_control_revision FROM bid_sessions WHERE id = ?')
        .get('mock-control-session-0035'),
    ).toEqual({ mock_control_revision: 0 });
    expect(() =>
      sqlite
        .prepare('UPDATE bid_sessions SET mock_control_revision = -1 WHERE id = ?')
        .run('mock-control-session-0035'),
    ).toThrow(/cannot decrease|check constraint failed/i);

    insertPendingReceipt(sqlite);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO mock_rehearsal_command_receipts (
            bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
            expected_mock_control_revision, state, created_at
          ) VALUES ('mock-control-session-0035', 'incomplete-completion-0035', 'auto_bid',
            'synthetic-admin',
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            0, 'completed', 1)`,
        )
        .run(),
    ).toThrow(/check constraint failed/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO mock_rehearsal_command_receipts (
            bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
            expected_mock_control_revision, state, created_at
          ) VALUES ('missing-session', 'unknown-session', 'auto_bid', 'synthetic-admin',
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 0, 'pending', 1)`,
        )
        .run(),
    ).toThrow(/foreign key constraint failed/i);
    expect(() =>
      sqlite
        .prepare(
          "UPDATE mock_rehearsal_command_receipts SET actor_subject = 'tampered' WHERE bid_session_id = ? AND idempotency_key = ?",
        )
        .run('mock-control-session-0035', 'mock-command-0035'),
    ).toThrow(/completion|immutable/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO mock_rehearsal_command_receipts (
            bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
            expected_mock_control_revision, state, created_at
          ) VALUES ('mock-control-session-0035', 'mock-command-0035', 'auto_bid', 'synthetic-admin',
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 0, 'pending', 2)`,
        )
        .run(),
    ).toThrow(/cannot be replaced|immutable/i);

    expect(() =>
      sqlite
        .prepare(
          `UPDATE mock_rehearsal_command_receipts
             SET state = 'completed', response_status = 201, response_json = '{"picksMade":1}',
                 resulting_mock_control_revision = 2, completed_at = 2
           WHERE bid_session_id = ? AND idempotency_key = ?`,
        )
        .run('mock-control-session-0035', 'mock-command-0035'),
    ).toThrow(/check constraint failed/i);
    expect(() =>
      sqlite
        .prepare(
          `UPDATE mock_rehearsal_command_receipts
             SET state = 'completed', response_status = 201, response_json = '{"picksMade":1}',
                 resulting_mock_control_revision = 1, completed_at = 2
           WHERE bid_session_id = ? AND idempotency_key = ?`,
        )
        .run('mock-control-session-0035', 'mock-command-0035'),
    ).not.toThrow();
    expect(
      sqlite
        .prepare(
          `SELECT state, response_status, response_json, resulting_mock_control_revision
             FROM mock_rehearsal_command_receipts
            WHERE bid_session_id = ? AND idempotency_key = ?`,
        )
        .get('mock-control-session-0035', 'mock-command-0035'),
    ).toEqual({
      state: 'completed',
      response_status: 201,
      response_json: '{"picksMade":1}',
      resulting_mock_control_revision: 1,
    });
    expect(() =>
      sqlite
        .prepare(
          'UPDATE mock_rehearsal_command_receipts SET response_json = \'{"picksMade":2}\' WHERE bid_session_id = ? AND idempotency_key = ?',
        )
        .run('mock-control-session-0035', 'mock-command-0035'),
    ).toThrow(/completion|immutable/i);
    expect(() =>
      sqlite
        .prepare(
          'DELETE FROM mock_rehearsal_command_receipts WHERE bid_session_id = ? AND idempotency_key = ?',
        )
        .run('mock-control-session-0035', 'mock-command-0035'),
    ).toThrow(/cannot be deleted|immutable/i);

    sqlite.close();
  });

  it('preserves a pre-0035 session during upgrade and starts its control revision at zero', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsThrough(sqlite, '0034_qualification_ledger_replace_guard.sql');
    insertBidSession(sqlite, 'upgrade-session-0035');
    const beforeUpgrade = sqlite
      .prepare(
        `SELECT id, bid_year, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock
           FROM bid_sessions WHERE id = ?`,
      )
      .get('upgrade-session-0035');

    applyRemainingMigrations(sqlite, '0034_qualification_ledger_replace_guard.sql');

    expect(
      sqlite
        .prepare(
          `SELECT id, bid_year, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock
             FROM bid_sessions WHERE id = ?`,
        )
        .get('upgrade-session-0035'),
    ).toEqual(beforeUpgrade);
    expect(
      sqlite
        .prepare('SELECT mock_control_revision FROM bid_sessions WHERE id = ?')
        .get('upgrade-session-0035'),
    ).toEqual({ mock_control_revision: 0 });
    expect(
      sqlite.prepare('SELECT count(*) AS count FROM mock_rehearsal_command_receipts').get(),
    ).toEqual({ count: 0 });

    sqlite.close();
  });
});
