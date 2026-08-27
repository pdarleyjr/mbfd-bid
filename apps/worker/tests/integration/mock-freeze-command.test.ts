import type { MockFreezeCommand } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

interface TestStorage {
  data: Map<string, unknown>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
  transaction<T>(closure: (txn: TestTransaction) => Promise<T>): Promise<T>;
  failNextStatePut(): void;
}

interface TestTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

function makeStorage(): TestStorage {
  const data = new Map<string, unknown>();
  let failNextStatePut = false;
  return {
    data,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      if (failNextStatePut && key.endsWith(':state')) {
        failNextStatePut = false;
        throw new Error('simulated DO projection write failure');
      }
      data.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async list<T>(prefix: string): Promise<Map<string, T>> {
      return new Map([...data].filter(([key]) => key.startsWith(prefix)) as Array<[string, T]>);
    },
    async transaction<T>(closure: (txn: TestTransaction) => Promise<T>): Promise<T> {
      const staged = new Map(data);
      const result = await closure({
        async get<U = unknown>(key: string): Promise<U | undefined> {
          return staged.get(key) as U | undefined;
        },
        async put<U>(key: string, value: U): Promise<void> {
          staged.set(key, value);
        },
      });
      data.clear();
      for (const [key, value] of staged) data.set(key, value);
      return result;
    },
    failNextStatePut() {
      failNextStatePut = true;
    },
  };
}

function makeStateMock(id: string, storage: TestStorage, name = id): DurableObjectState {
  return {
    id: { toString: () => id, equals: () => false, name } as unknown as DurableObjectId,
    storage: storage as unknown as DurableObjectStorage,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    waitUntil() {},
    acceptWebSocket() {},
    getWebSockets: () => [],
    setHibernatableWebSocketEventTimeout() {},
    getHibernatableWebSocketEventTimeout: () => null,
    setWebSocketAutoResponse() {},
    getWebSocketAutoResponseTimestamp: () => null,
    abort() {},
  } as unknown as DurableObjectState;
}

async function seedMockSession(h: TestD1, sessionId: string): Promise<void> {
  await h.db.run('INSERT INTO bid_years (year, status) VALUES (?, ?)', [2030, 'configuring']);
  await h.db.run(
    `INSERT INTO bid_sessions (
      id, bid_year, started_at, current_phase, turn_timer_seconds,
      expected_duration_days, day_count, is_mock
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, 2030, 1, 'position_bid', 180, 2, 0, 1],
  );
}

describe('mock freeze canonical command', () => {
  const sessionId = '01HZZ0000000000000MOCKCMD1';
  const commandId = '11111111-1111-4111-8111-111111111111';
  let storage: TestStorage;
  let doInstance: BidSessionDO;
  let initialState: BidSessionState;
  let h: TestD1;

  function command(overrides: Partial<MockFreezeCommand> = {}): MockFreezeCommand {
    return {
      v: 1,
      type: 'mock.freeze',
      commandId,
      bidSessionId: sessionId,
      expectedSeq: 7,
      actor: { id: 0, role: 'admin' },
      reason: 'Mock exercise pause',
      ...overrides,
    };
  }

  async function count(table: string): Promise<number> {
    const result = await h.db.run(`SELECT count(*) AS count FROM ${table}`);
    return Number(result.results[0]?.count);
  }

  beforeEach(async () => {
    h = await setupTestD1();
    await seedMockSession(h, sessionId);
    storage = makeStorage();
    initialState = {
      ...emptyBidSessionState(sessionId),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      turnStartedAtMs: 1700000000000,
      lastSeq: 7,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF' }],
    };
    await storage.put(`bs:${sessionId}:state`, initialState);
    doInstance = new BidSessionDO(makeStateMock(sessionId, storage), h.env);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('commits one D1-authoritative receipt/state/event/audit/outbox bundle and replays an exact duplicate', async () => {
    const first = await doInstance.adminMockFreezeCommand(command());
    expect(first.kind).toBe('accepted');
    if (first.kind !== 'accepted') return;
    expect(first.seq).toBe(8);
    expect(first.envelope.type).toBe('freeze');

    const persisted = await storage.get<BidSessionState>(`bs:${sessionId}:state`);
    expect(persisted).toMatchObject({ lastSeq: 8, currentPhase: 'paused' });
    expect(persisted?.frozenAt).not.toBeNull();
    expect(await count('bid_command_receipts')).toBe(1);
    expect(await count('bid_command_events')).toBe(1);
    expect(await count('audit_log')).toBe(1);
    expect(await count('bid_audit_outbox')).toBe(1);

    const replay = await doInstance.adminMockFreezeCommand(command());
    expect(replay).toEqual(first);
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(8);
    expect(await count('bid_command_events')).toBe(1);
  });

  it('does not allow a frozen canonical session to transition to Phase 2', async () => {
    const frozen = await doInstance.adminMockFreezeCommand(command());
    expect(frozen.kind).toBe('accepted');

    const transition = await doInstance.transitionToPhase2({
      members: [],
      phase1Order: [],
      phase1Picks: [],
    });

    expect(transition).toEqual({ ok: false });
    expect(await storage.get<BidSessionState>(`bs:${sessionId}:state`)).toMatchObject({
      currentPhase: 'paused',
      frozenAt: expect.any(Number),
      lastSeq: 8,
    });
  });

  it('records and replays a stale-sequence rejection without changing state, event, audit, or outbox', async () => {
    const stale = await doInstance.adminMockFreezeCommand(command({ expectedSeq: 6 }));
    expect(stale).toEqual({
      kind: 'rejected',
      commandId,
      code: 'STALE_SEQUENCE',
      currentSeq: 7,
    });
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(7);
    expect(await doInstance.adminMockFreezeCommand(command({ expectedSeq: 6 }))).toEqual(stale);
    expect(await count('bid_command_receipts')).toBe(1);
    expect(await count('canonical_bid_session_state')).toBe(0);
    expect(await count('bid_command_events')).toBe(0);
    expect(await count('audit_log')).toBe(0);
    expect(await count('bid_audit_outbox')).toBe(0);
  });

  it('rejects an initial canonical freeze when legacy position-bid state has no audited importer', async () => {
    await h.db.run(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 42, 'FF'), (?, 2, 43, 'FF');",
      [sessionId, sessionId],
    );
    await h.db.run(
      `INSERT INTO bids (
        id, bid_session_id, ordinal, member_id, position_id, picked_at,
        forced, idempotency_key, portal_sync_status, portal_sync_attempts
      ) VALUES (?, ?, 1, 42, 'A101', 100, 0, ?, 'pending', 0);`,
      ['legacy-bid-001', sessionId, `legacy-bid:${sessionId}:A101`],
    );
    await h.db.run(
      `UPDATE bid_sessions
          SET current_phase = 'position_bid', current_bidder_id = 43,
              current_turn_started_at = 99, turn_timer_seconds = 240
        WHERE id = ?;`,
      [sessionId],
    );

    const rejected = await doInstance.adminMockFreezeCommand(command());

    expect(rejected).toEqual({
      kind: 'rejected',
      commandId,
      code: 'LEGACY_STATE_REQUIRES_IMPORT',
      currentSeq: 7,
    });
    expect(await count('canonical_bid_session_state')).toBe(0);
    expect(await count('bid_command_receipts')).toBe(1);
    expect(await count('bid_command_events')).toBe(0);
    expect(await count('audit_log')).toBe(0);
    expect(await count('bid_audit_outbox')).toBe(0);
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(7);
  });

  it('rejects an initial canonical freeze for legacy A-Day state that has no audited importer', async () => {
    await h.db.run(
      `INSERT INTO a_day_picks (
        id, bid_session_id, member_id, shift, a_day, picked_at, forced, idempotency_key
      ) VALUES (?, ?, 42, 'A', 'G1', 100, 0, ?);`,
      ['legacy-a-day-001', sessionId, `legacy-a-day:${sessionId}:42`],
    );

    const rejected = await doInstance.adminMockFreezeCommand(command());

    expect(rejected).toEqual({
      kind: 'rejected',
      commandId,
      code: 'LEGACY_A_DAY_STATE_REQUIRES_IMPORT',
      currentSeq: 7,
    });
    expect(await count('canonical_bid_session_state')).toBe(0);
    expect(await count('bid_command_receipts')).toBe(1);
    expect(await count('bid_command_events')).toBe(0);
    expect(await count('audit_log')).toBe(0);
    expect(await count('bid_audit_outbox')).toBe(0);
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(7);
  });

  it('rejects a command for a different named session without writing a receipt', async () => {
    const mismatch = await doInstance.adminMockFreezeCommand(
      command({ bidSessionId: '01HZZ0000000000000OTHERCM' }),
    );
    expect(mismatch).toEqual({
      kind: 'rejected',
      commandId,
      code: 'SESSION_ID_MISMATCH',
      currentSeq: 7,
    });
    expect(await count('bid_command_receipts')).toBe(0);
  });

  it('does not promote a non-mock session through the internal named-DO command', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 0 WHERE id = ?', [sessionId]);

    const rejected = await doInstance.adminMockFreezeCommand(command());

    expect(rejected).toEqual({
      kind: 'rejected',
      commandId,
      code: 'NOT_A_MOCK_SESSION',
      currentSeq: 7,
    });
    expect(await count('canonical_bid_session_state')).toBe(0);
    expect(await count('bid_command_receipts')).toBe(0);
    expect(await count('bid_command_events')).toBe(0);
    expect(await count('audit_log')).toBe(0);
    expect(await count('bid_audit_outbox')).toBe(0);
  });

  it('binds the D1 session id to a named DO while retaining the opaque durable-storage key', async () => {
    const opaqueDoId = 'opaque-do-id';
    const namedStorage = makeStorage();
    const namedState: BidSessionState = {
      ...emptyBidSessionState(opaqueDoId),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      turnStartedAtMs: 1700000000000,
      lastSeq: 7,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF' }],
    };
    await namedStorage.put(`bs:${opaqueDoId}:state`, namedState);
    const namedDo = new BidSessionDO(makeStateMock(opaqueDoId, namedStorage, sessionId), h.env);

    const result = await namedDo.adminMockFreezeCommand(command());

    expect(result.kind).toBe('accepted');
    expect((await namedStorage.get<BidSessionState>(`bs:${opaqueDoId}:state`))?.lastSeq).toBe(8);
    const canonical = await h.db.run(
      'SELECT bid_session_id, current_seq FROM canonical_bid_session_state WHERE bid_session_id = ?',
      [sessionId],
    );
    expect(canonical.results).toEqual([{ bid_session_id: sessionId, current_seq: 8 }]);
  });

  it('rejects a reused command id when its request fingerprint differs', async () => {
    await doInstance.adminMockFreezeCommand(command());

    const conflict = await doInstance.adminMockFreezeCommand(
      command({ expectedSeq: 8, reason: 'Different command body' }),
    );
    expect(conflict).toEqual({
      kind: 'rejected',
      commandId,
      code: 'COMMAND_ID_REUSED',
      currentSeq: 8,
    });
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(8);
    expect(await count('bid_command_receipts')).toBe(1);
  });

  it('does not expose private command receipts through the state snapshot', async () => {
    await doInstance.adminMockFreezeCommand(command());

    const res = await doInstance.fetch(new Request('https://do/snapshot'));
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('commandReceipts');
    expect(snapshot).not.toHaveProperty('reason');
  });

  it('does not require D1 for a snapshot before canonical mock intent exists', async () => {
    const legacy = new BidSessionDO(makeStateMock(sessionId, storage), {
      ...h.env,
      DB: undefined,
    } as unknown as typeof h.env);

    const snapshot = await legacy.fetch(new Request('https://do/snapshot'));

    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ currentPhase: 'position_bid', lastSeq: 7 });
  });

  it('clears canonical intent after a confirmed rejected command', async () => {
    const rejected = await doInstance.adminMockFreezeCommand(command({ expectedSeq: 6 }));
    expect(rejected).toMatchObject({ kind: 'rejected', code: 'STALE_SEQUENCE', currentSeq: 7 });

    const recovered = new BidSessionDO(makeStateMock(sessionId, storage), {
      ...h.env,
      DB: undefined,
    } as unknown as typeof h.env);
    const snapshot = await recovered.fetch(new Request('https://do/snapshot'));

    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ currentPhase: 'position_bid', lastSeq: 7 });
  });

  it('does not leave canonical intent after a D1 preflight failure', async () => {
    const unavailable = new BidSessionDO(makeStateMock(sessionId, storage), {
      ...h.env,
      DB: {
        prepare() {
          throw new Error('simulated D1 preflight outage');
        },
      },
    } as unknown as typeof h.env);

    await expect(unavailable.adminMockFreezeCommand(command())).rejects.toThrow(
      'simulated D1 preflight outage',
    );

    const recovered = new BidSessionDO(makeStateMock(sessionId, storage), {
      ...h.env,
      DB: undefined,
    } as unknown as typeof h.env);
    const snapshot = await recovered.fetch(new Request('https://do/snapshot'));

    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ currentPhase: 'position_bid', lastSeq: 7 });
  });

  it('does not leave canonical intent after a rejected-receipt batch failure', async () => {
    const failingReceiptBatch = new BidSessionDO(makeStateMock(sessionId, storage), {
      ...h.env,
      DB: {
        prepare: h.env.DB.prepare.bind(h.env.DB),
        batch: async () => {
          throw new Error('simulated rejected receipt batch failure');
        },
        exec: h.env.DB.exec.bind(h.env.DB),
        dump: h.env.DB.dump.bind(h.env.DB),
      },
    } as unknown as typeof h.env);

    await expect(
      failingReceiptBatch.adminMockFreezeCommand(command({ expectedSeq: 6 })),
    ).rejects.toThrow('simulated rejected receipt batch failure');

    const recovered = new BidSessionDO(makeStateMock(sessionId, storage), {
      ...h.env,
      DB: undefined,
    } as unknown as typeof h.env);
    const snapshot = await recovered.fetch(new Request('https://do/snapshot'));

    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ currentPhase: 'position_bid', lastSeq: 7 });
  });

  it('refuses a direct mock reset until an audited reset epoch exists', async () => {
    const reset = await doInstance.fetch(new Request('https://do/reset-mock', { method: 'POST' }));

    expect(reset.status).toBe(409);
    expect(await reset.json()).toEqual({ error: 'canonical_reset_requires_new_epoch' });
    expect(await storage.get<BidSessionState>(`bs:${sessionId}:state`)).toEqual(initialState);
  });

  it('rejects malformed internal command payloads before invoking the command handler', async () => {
    const res = await doInstance.fetch(
      new Request('https://do/admin/commands/mock-freeze', {
        method: 'POST',
        body: JSON.stringify({ commandId, expectedSeq: 7, reason: 'incomplete' }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_mock_freeze_command' });
    expect(await storage.get<BidSessionState>(`bs:${sessionId}:state`)).toEqual(initialState);
    expect(await count('bid_command_receipts')).toBe(0);
  });

  it('reconstructs DO projection from the D1 state after a projection-write failure', async () => {
    storage.failNextStatePut();

    await expect(doInstance.adminMockFreezeCommand(command())).rejects.toThrow(
      'simulated DO projection write failure',
    );
    expect(await count('bid_command_receipts')).toBe(1);
    expect(await count('bid_command_events')).toBe(1);

    const recovered = new BidSessionDO(makeStateMock(sessionId, storage), h.env);
    const snapshot = await recovered.fetch(new Request('https://do/snapshot'));
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ currentPhase: 'paused', lastSeq: 8 });
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(8);
  });
});
