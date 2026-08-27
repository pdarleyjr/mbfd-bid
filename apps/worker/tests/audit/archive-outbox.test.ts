import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MockFreezeCommand } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { drainBidAuditOutbox } from '../../src/audit/archive-outbox.js';
import { commitMockFreezeCommand } from '../../src/commands/canonical-command-service.js';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

function applyMigrationsStrict(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

type RunOverride =
  | { kind: 'result'; result: unknown }
  | { kind: 'throw'; error: Error }
  | undefined;

function makeTransactionalD1(
  sqlite: Database.Database,
  runOverride?: (query: string) => RunOverride,
): D1Database {
  function prepare(query: string) {
    let boundArgs: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return statement;
      },
      async run() {
        return execute();
      },
      async all() {
        return {
          success: true,
          results: sqlite.prepare(query).all(...boundArgs) as Record<string, unknown>[],
          meta: {},
        };
      },
      async first() {
        return (
          (sqlite.prepare(query).get(...boundArgs) as Record<string, unknown> | undefined) ?? null
        );
      },
      async raw<T = unknown[]>() {
        return sqlite
          .prepare(query)
          .raw()
          .all(...boundArgs) as T[];
      },
      __execute: execute,
    };
    function execute() {
      const override = runOverride?.(query);
      if (override?.kind === 'throw') throw override.error;
      if (override?.kind === 'result') return override.result;
      const info = sqlite.prepare(query).run(...boundArgs);
      return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
    }
    return statement;
  }

  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const transaction = sqlite.transaction((items: readonly unknown[]) =>
        items.map((item) => (item as { __execute(): unknown }).__execute()),
      );
      return transaction(statements) as never;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

function seedSession(sqlite: Database.Database, sessionId: string): void {
  sqlite.prepare('INSERT INTO bid_years (year, status) VALUES (?, ?)').run(2030, 'configuring');
  sqlite
    .prepare(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, 2030, 1, 'position_bid', 180, 2, 0, 1);
}

function mockCommand(sessionId: string): MockFreezeCommand {
  return {
    v: 1,
    type: 'mock.freeze',
    commandId: '11111111-1111-4111-8111-111111111111',
    bidSessionId: sessionId,
    expectedSeq: 0,
    actor: { id: 0, role: 'admin' },
    reason: 'Archive outbox rehearsal',
  };
}

describe('drainBidAuditOutbox', () => {
  const sessionId = '01HZZ0000000000000OUTBOX';
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedSession(sqlite, sessionId);
    db = makeTransactionalD1(sqlite);
    let nextId = 0;
    await commitMockFreezeCommand({
      db,
      command: mockCommand(sessionId),
      state: { ...emptyBidSessionState(sessionId), currentPhase: 'position_bid' },
      nowMs: () => 100,
      newId: () => `outbox-test-${++nextId}`,
    });
  });

  afterEach(() => sqlite.close());

  it('archives a committed payload asynchronously and marks only delivery fields as archived', async () => {
    const puts: Array<{ key: string; body: string }> = [];
    const r2 = {
      async put(key: string, body: string) {
        puts.push({ key, body });
      },
    } as unknown as R2Bucket;

    const result = await drainBidAuditOutbox({
      db,
      r2,
      nowMs: () => 200,
      leaseOwner: 'test-success',
    });

    expect(result).toEqual({
      scanned: 1,
      archived: 1,
      retried: 0,
      deadLettered: 0,
      r2PutFailures: 0,
      acknowledgementFailures: 0,
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toMatch(/^canonical-audit\//);
    expect(
      sqlite
        .prepare(
          'SELECT status, attempts, archived_at, lease_owner, lease_expires_at FROM bid_audit_outbox',
        )
        .get(),
    ).toMatchObject({ status: 'archived', attempts: 1, archived_at: 200, lease_owner: null });
  });

  it('records an R2 failure as retryable work without undoing the accepted command', async () => {
    const r2 = {
      async put() {
        throw new Error('simulated R2 outage');
      },
    } as unknown as R2Bucket;

    const result = await drainBidAuditOutbox({
      db,
      r2,
      nowMs: () => 200,
      leaseOwner: 'test-retry',
      retryDelayMs: () => 500,
    });

    expect(result).toEqual({
      scanned: 1,
      archived: 0,
      retried: 1,
      deadLettered: 0,
      r2PutFailures: 1,
      acknowledgementFailures: 0,
    });
    expect(
      sqlite
        .prepare('SELECT status, attempts, next_attempt_at, last_error FROM bid_audit_outbox')
        .get(),
    ).toEqual({
      status: 'retry',
      attempts: 1,
      next_attempt_at: 700,
      last_error: 'R2_ARCHIVE_FAILED',
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 1 });
  });

  it('does not report archival when R2 succeeds but the conditional D1 acknowledgement changes no row', async () => {
    db = makeTransactionalD1(sqlite, (query) =>
      query.includes("SET status = 'archived'")
        ? { kind: 'result', result: { success: true, meta: { changes: 0 } } }
        : undefined,
    );
    const r2 = { put: async () => undefined } as unknown as R2Bucket;

    const result = await drainBidAuditOutbox({
      db,
      r2,
      nowMs: () => 200,
      leaseOwner: 'test-archive-ack-zero',
    });

    expect(result).toEqual({
      scanned: 1,
      archived: 0,
      retried: 0,
      deadLettered: 0,
      r2PutFailures: 0,
      acknowledgementFailures: 1,
    });
    expect(sqlite.prepare('SELECT status, last_error FROM bid_audit_outbox').get()).toEqual({
      status: 'leased',
      last_error: null,
    });
  });

  it('records a D1 acknowledgement exception separately after an R2 success', async () => {
    db = makeTransactionalD1(sqlite, (query) =>
      query.includes("SET status = 'archived'")
        ? { kind: 'throw', error: new Error('simulated D1 acknowledgement failure') }
        : undefined,
    );
    const r2 = { put: async () => undefined } as unknown as R2Bucket;

    const result = await drainBidAuditOutbox({
      db,
      r2,
      nowMs: () => 200,
      leaseOwner: 'test-archive-ack-throw',
    });

    expect(result).toEqual({
      scanned: 1,
      archived: 0,
      retried: 0,
      deadLettered: 0,
      r2PutFailures: 0,
      acknowledgementFailures: 1,
    });
    expect(sqlite.prepare('SELECT status, last_error FROM bid_audit_outbox').get()).toEqual({
      status: 'leased',
      last_error: null,
    });
  });

  it('counts an unacknowledged retry separately when R2 fails', async () => {
    db = makeTransactionalD1(sqlite, (query) =>
      query.includes("SET status = 'retry'")
        ? { kind: 'result', result: { success: true, meta: { changes: 0 } } }
        : undefined,
    );
    const r2 = {
      async put() {
        throw new Error('simulated R2 outage');
      },
    } as unknown as R2Bucket;

    const result = await drainBidAuditOutbox({
      db,
      r2,
      nowMs: () => 200,
      leaseOwner: 'test-retry-ack-zero',
      retryDelayMs: () => 500,
    });

    expect(result).toEqual({
      scanned: 1,
      archived: 0,
      retried: 0,
      deadLettered: 0,
      r2PutFailures: 1,
      acknowledgementFailures: 1,
    });
    expect(sqlite.prepare('SELECT status, last_error FROM bid_audit_outbox').get()).toEqual({
      status: 'leased',
      last_error: null,
    });
  });
});
