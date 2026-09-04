import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_GROUP_CAPACITY } from '@mbfd/a-day';
import type { FrozenLiveBidPolicy, LiveBidCommand, MockFreezeCommand } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commitLiveBidCommand,
  commitMockFreezeCommand,
} from '../src/commands/canonical-command-service.js';
import { getDb } from '../src/db/index.js';
import { auditLog } from '../src/db/schema.js';
import { type BidSessionState, emptyBidSessionState } from '../src/durable/bid-session-state.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

function applyMigrationsStrict(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function makeTransactionalD1(
  sqlite: Database.Database,
  shouldFail?: (query: string) => boolean,
): D1Database {
  function prepare(query: string) {
    let boundArgs: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return statement;
      },
      async run() {
        const result = execute();
        return result;
      },
      async all() {
        const results = sqlite.prepare(query).all(...boundArgs) as Record<string, unknown>[];
        return { success: true, results, meta: {} };
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
      if (shouldFail?.(query)) throw new Error('simulated D1 batch failure');
      const info = sqlite.prepare(query).run(...boundArgs);
      return {
        success: true,
        meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
      };
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

function seedMockSession(sqlite: Database.Database, sessionId: string): void {
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

function aDayStateWithPick(): NonNullable<BidSessionState['aDay']> {
  return {
    groupCaps: {
      A: {
        G1: DEFAULT_GROUP_CAPACITY,
        G2: DEFAULT_GROUP_CAPACITY,
        G3: DEFAULT_GROUP_CAPACITY,
        G4: DEFAULT_GROUP_CAPACITY,
      },
      B: {
        G1: DEFAULT_GROUP_CAPACITY,
        G2: DEFAULT_GROUP_CAPACITY,
        G3: DEFAULT_GROUP_CAPACITY,
        G4: DEFAULT_GROUP_CAPACITY,
      },
      C: {
        G1: DEFAULT_GROUP_CAPACITY,
        G2: DEFAULT_GROUP_CAPACITY,
        G3: DEFAULT_GROUP_CAPACITY,
        G4: DEFAULT_GROUP_CAPACITY,
      },
    },
    weekdayCaps: {},
    picks: [
      {
        memberId: 42,
        shift: 'A',
        aDay: 'G1',
        pickedAtMs: 1,
        forced: false,
        adminActorId: null,
      },
    ],
    bidOrder: [42],
    cursor: 1,
    phase1: [[42, { positionId: 'A101', shift: 'A' }]],
  };
}

describe('commitMockFreezeCommand', () => {
  const sessionId = '01HZZ0000000000000CANON1';
  const commandId = '11111111-1111-4111-8111-111111111111';
  let sqlite: Database.Database;
  let state: BidSessionState;

  function command(overrides: Partial<MockFreezeCommand> = {}): MockFreezeCommand {
    return {
      v: 1,
      type: 'mock.freeze',
      commandId,
      bidSessionId: sessionId,
      expectedSeq: 7,
      actor: { id: 0, role: 'admin' },
      reason: 'Canonical rehearsal pause',
      ...overrides,
    };
  }

  function ids() {
    let next = 0;
    return () => `canonical-0022-${++next}`;
  }

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, sessionId);
    state = {
      ...emptyBidSessionState(sessionId),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      turnStartedAtMs: 1,
      lastSeq: 7,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF' }],
    };
  });

  afterEach(() => sqlite.close());

  it('commits state, receipt, event, audit, and retryable archive work atomically then replays an exact duplicate', async () => {
    const db = makeTransactionalD1(sqlite);
    const first = await commitMockFreezeCommand({
      db,
      command: command(),
      state,
      nowMs: () => 100,
      newId: ids(),
    });

    expect(first.result).toMatchObject({
      kind: 'accepted',
      commandId,
      seq: 8,
      envelope: { type: 'freeze', seq: 8 },
    });
    expect(first.canonicalState).toMatchObject({
      bidSessionId: sessionId,
      currentPhase: 'paused',
      frozenAt: 100,
      lastSeq: 8,
    });
    expect(
      sqlite
        .prepare(
          'SELECT current_seq, last_command_id FROM canonical_bid_session_state WHERE bid_session_id = ?',
        )
        .get(sessionId),
    ).toEqual({ current_seq: 8, last_command_id: commandId });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT status, attempts FROM bid_audit_outbox').get()).toEqual({
      status: 'pending',
      attempts: 0,
    });

    const replay = await commitMockFreezeCommand({
      db,
      command: command(),
      state,
      nowMs: () => 101,
      newId: ids(),
    });
    expect(replay).toEqual(first);
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
  });

  it('writes the flat audit timestamp in the timestamp column seconds unit', async () => {
    const db = makeTransactionalD1(sqlite);
    await commitMockFreezeCommand({
      db,
      command: command(),
      state,
      nowMs: () => 1_700_000_000_123,
      newId: ids(),
    });

    const row = await getDb(db).select({ createdAt: auditLog.createdAt }).from(auditLog).get();
    expect(row?.createdAt.getTime()).toBe(1_700_000_000_000);
  });

  it('keeps flat audit sequence allocation independent from the canonical command sequence', async () => {
    sqlite
      .prepare(
        `INSERT INTO audit_log (
          id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at
        ) VALUES (?, ?, 1, 'admin', 0, 'session_start', 'bid_session', ?, NULL, NULL, NULL, NULL, NULL, 1)`,
      )
      .run('legacy-session-start-0022', sessionId, sessionId);

    const result = await commitMockFreezeCommand({
      db: makeTransactionalD1(sqlite),
      command: command(),
      state,
      nowMs: () => 100,
      newId: ids(),
    });

    expect(result.result).toMatchObject({ kind: 'accepted', seq: 8 });
    expect(
      sqlite
        .prepare('SELECT seq FROM audit_log WHERE bid_session_id = ? ORDER BY seq')
        .all(sessionId),
    ).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(
      sqlite
        .prepare(
          `SELECT event.seq AS canonical_seq, audit.seq AS audit_seq
             FROM bid_command_events event
             INNER JOIN audit_log audit ON audit.id = event.audit_log_id`,
        )
        .get(),
    ).toEqual({ canonical_seq: 8, audit_seq: 2 });
  });

  it('persists a stale rejection without changing canonical state, event, audit, or outbox', async () => {
    const result = await commitMockFreezeCommand({
      db: makeTransactionalD1(sqlite),
      command: command({ expectedSeq: 6 }),
      state,
      nowMs: () => 100,
      newId: ids(),
      beforeD1Commit: async () => {
        throw new Error('rejected receipt must not arm canonical recovery');
      },
    });

    expect(result).toEqual({
      result: {
        kind: 'rejected',
        commandId,
        code: 'STALE_SEQUENCE',
        currentSeq: 7,
      },
      canonicalState: null,
    });
    expect(
      sqlite.prepare('SELECT count(*) AS count FROM canonical_bid_session_state').get(),
    ).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT outcome, result_seq FROM bid_command_receipts').get()).toEqual({
      outcome: 'rejected',
      result_seq: null,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_audit_outbox').get()).toEqual({
      count: 0,
    });
  });

  it.each([
    {
      label: 'in-memory position fills',
      state: () => ({
        ...state,
        fills: { A101: { memberId: 42, ordinal: 1, bidId: 'do-only-position-pick' } },
      }),
      code: 'LEGACY_STATE_REQUIRES_IMPORT',
    },
    {
      label: 'in-memory A-Day picks',
      state: () => ({ ...state, aDay: aDayStateWithPick() }),
      code: 'LEGACY_A_DAY_STATE_REQUIRES_IMPORT',
    },
  ])(
    'rejects an initial canonical freeze when $label have no audited importer',
    async ({ state: stateForCommand, code }) => {
      const result = await commitMockFreezeCommand({
        db: makeTransactionalD1(sqlite),
        command: command(),
        state: stateForCommand(),
        nowMs: () => 100,
        newId: ids(),
      });

      expect(result).toEqual({
        result: {
          kind: 'rejected',
          commandId,
          code,
          currentSeq: 7,
        },
        canonicalState: null,
      });
      expect(
        sqlite.prepare('SELECT count(*) AS count FROM canonical_bid_session_state').get(),
      ).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT outcome FROM bid_command_receipts').get()).toEqual({
        outcome: 'rejected',
      });
      expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
        count: 0,
      });
      expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT count(*) AS count FROM bid_audit_outbox').get()).toEqual({
        count: 0,
      });
    },
  );

  it('returns a typed stale sequence result when a competing command commits first', async () => {
    const db = makeTransactionalD1(sqlite);
    const winnerCommandId = '22222222-2222-4222-8222-222222222222';
    const loserCommandId = '33333333-3333-4333-8333-333333333333';

    const loser = await commitMockFreezeCommand({
      db,
      command: command({ commandId: loserCommandId }),
      state,
      nowMs: () => 100,
      newId: ids(),
      beforeD1Commit: async () => {
        const winner = await commitMockFreezeCommand({
          db,
          command: command({ commandId: winnerCommandId }),
          state,
          nowMs: () => 99,
          newId: ids(),
        });
        expect(winner.result).toMatchObject({ kind: 'accepted', seq: 8 });
      },
    });

    expect(loser).toEqual({
      result: {
        kind: 'rejected',
        commandId: loserCommandId,
        code: 'STALE_SEQUENCE',
        currentSeq: 8,
      },
      canonicalState: null,
    });
    expect(
      sqlite
        .prepare(
          'SELECT current_seq, last_command_id FROM canonical_bid_session_state WHERE bid_session_id = ?',
        )
        .get(sessionId),
    ).toEqual({ current_seq: 8, last_command_id: winnerCommandId });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
  });

  it('does not create a partial canonical record when the D1 transaction fails', async () => {
    await expect(
      commitMockFreezeCommand({
        db: makeTransactionalD1(sqlite, (query) => query.includes('INSERT INTO bid_audit_outbox')),
        command: command(),
        state,
        nowMs: () => 100,
        newId: ids(),
      }),
    ).rejects.toThrow('simulated D1 batch failure');

    expect(
      sqlite.prepare('SELECT count(*) AS count FROM canonical_bid_session_state').get(),
    ).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_audit_outbox').get()).toEqual({
      count: 0,
    });
  });

  it('rejects a command-id reuse with a different canonical request hash without changing the accepted event', async () => {
    const db = makeTransactionalD1(sqlite);
    await commitMockFreezeCommand({
      db,
      command: command(),
      state,
      nowMs: () => 100,
      newId: ids(),
    });

    const conflict = await commitMockFreezeCommand({
      db,
      command: command({ expectedSeq: 8, reason: 'Different command body' }),
      state,
      nowMs: () => 101,
      newId: ids(),
    });

    expect(conflict).toEqual({
      result: {
        kind: 'rejected',
        commandId,
        code: 'COMMAND_ID_REUSED',
        currentSeq: 8,
      },
      canonicalState: null,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
  });
});

describe('commitLiveBidCommand canonical authority', () => {
  const sessionId = '01HZZ0000000000000LIVE01';
  let sqlite: Database.Database;

  const policy: FrozenLiveBidPolicy = {
    v: 1,
    policyRevision: 'policy-live-test',
    stages: [
      {
        id: 'd',
        label: 'D',
        order: 0,
        memberIds: [42],
        opportunityPositionIds: ['D101'],
        kind: 'D_SHIFT',
      },
    ],
    dispositions: (['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const).map(
      (disposition) => ({
        disposition,
        advances: disposition !== 'HOLD',
        returns: false,
        returnStageId: null,
        retainsLaterSelectionRights: false,
        terminal: disposition === 'DECLINED',
        requiresReason: true,
        requiresEvidence: disposition === 'UNREACHABLE',
        contactPolicyReference: null,
      }),
    ),
    actionPermissions: (
      [
        'record_selection',
        'amend_selection',
        'skip_defer',
        'mark_unreachable',
        'force',
        'resolve_tie',
        'alter_order',
        'pause_resume',
        'approve_transition',
        'approve_final_results',
        'publish',
      ] as const
    ).map((action) => ({ action, actorMemberIds: [99] })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    applyMigrationsStrict(sqlite);
    seedMockSession(sqlite, sessionId);
  });

  afterEach(() => sqlite.close());

  it('commits a selection only to canonical state and immutable command evidence', async () => {
    const state: BidSessionState = {
      ...emptyBidSessionState(sessionId),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF', stageId: 'd' }],
      live: {
        currentStageId: 'd',
        completedStageIds: [],
        pausedPhase: null,
        lastSelectionBidId: null,
        dispositions: [],
      },
    };
    const command: LiveBidCommand = {
      v: 1,
      type: 'live.record_selection',
      commandId: '22222222-2222-4222-8222-222222222222',
      bidSessionId: sessionId,
      expectedSeq: 0,
      actor: { id: 99, role: 'admin' },
      reason: 'Recorded during annual mock acceptance',
      evidenceReference: null,
      memberId: 42,
      positionId: 'D101',
      preferenceSheetId: null,
    };

    const committed = await commitLiveBidCommand({
      db: makeTransactionalD1(sqlite),
      command,
      state,
      policy,
      nowMs: () => 1_700_000_000_000,
      newId: (() => {
        let next = 0;
        return () => `canonical-live-${++next}`;
      })(),
    });

    expect(committed.result).toMatchObject({ kind: 'accepted', seq: 1 });
    expect(committed.canonicalState?.fills.D101).toMatchObject({ memberId: 42, ordinal: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bids').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 1 });
  });
});
