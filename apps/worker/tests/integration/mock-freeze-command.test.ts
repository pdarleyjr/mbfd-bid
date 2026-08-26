import type { D1Database } from '@cloudflare/workers-types';
import type { MockFreezeCommand } from '@mbfd/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import type { WorkerEnv } from '../../src/types/env.js';

interface TestStorage {
  data: Map<string, unknown>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
  transaction<T>(closure: (txn: TestTransaction) => Promise<T>): Promise<T>;
  failNextTransaction(): void;
}

interface TestTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

function makeStorage(): TestStorage {
  const data = new Map<string, unknown>();
  let failNext = false;
  return {
    data,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
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
      if (failNext) {
        failNext = false;
        throw new Error('simulated local transaction failure');
      }
      data.clear();
      for (const [key, value] of staged) data.set(key, value);
      return result;
    },
    failNextTransaction() {
      failNext = true;
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
    getWebSocketAutoResponse: () => null,
    getWebSocketAutoResponseTimestamp: () => null,
    abort() {},
  } as unknown as DurableObjectState;
}

function makeStubDb(): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        run: async () => ({ success: true, meta: { changes: 0, last_row_id: 0 } }),
        all: async () => ({ results: [], success: true, meta: {} }),
        first: async () => null,
        raw: async () => [],
      }),
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

describe('mock freeze canonical command', () => {
  const sessionId = '01HZZ0000000000000MOCKCMD1';
  const commandId = '11111111-1111-4111-8111-111111111111';
  let storage: TestStorage;
  let doInstance: BidSessionDO;
  let initialState: BidSessionState;

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

  beforeEach(async () => {
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
    doInstance = new BidSessionDO(makeStateMock(sessionId, storage), {
      ENV: 'staging',
      PORTAL_BASE_URL: 'https://portal.test',
      JWT_SIGNING_KEY: 'k'.repeat(64),
      PIN_HASH: '$2b$12$placeholder',
      PORTAL_BID_READER: 'test-reader',
      DB: makeStubDb(),
      KV: {} as never,
      BID_SESSION: {} as never,
      AUDIT_SIGNING_PRIVKEY: '',
      AUDIT_SIGNING_PUBKEY: '',
      R2_AUDIT: {} as never,
      R2_EXPORTS: {} as never,
      PORTAL_QUEUE: {} as never,
      BROWSER: {} as never,
    } satisfies WorkerEnv);
  });

  it('commits one DO-local receipt and replays it without reapplying the freeze', async () => {
    const first = await doInstance.adminMockFreezeCommand(command());
    expect(first.kind).toBe('accepted');
    if (first.kind !== 'accepted') return;
    expect(first.seq).toBe(8);
    expect(first.envelope.type).toBe('freeze');

    const persisted = await storage.get<BidSessionState>(`bs:${sessionId}:state`);
    expect(persisted).toMatchObject({ lastSeq: 8, currentPhase: 'paused' });
    expect(persisted?.frozenAt).not.toBeNull();
    expect(
      [...storage.data.keys()].filter((key) => key.startsWith(`cmd:${sessionId}:`)),
    ).toHaveLength(1);

    const replay = await doInstance.adminMockFreezeCommand(command());
    expect(replay).toEqual(first);
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(8);
  });

  it('records and replays a stale-sequence rejection without changing state', async () => {
    const stale = await doInstance.adminMockFreezeCommand(command({ expectedSeq: 6 }));
    expect(stale).toEqual({
      kind: 'rejected',
      commandId,
      code: 'STALE_SEQUENCE',
      currentSeq: 7,
    });
    expect((await storage.get<BidSessionState>(`bs:${sessionId}:state`))?.lastSeq).toBe(7);
    expect(await doInstance.adminMockFreezeCommand(command({ expectedSeq: 6 }))).toEqual(stale);
  });

  it('rejects a command for a different named session without leaving a receipt', async () => {
    const mismatch = await doInstance.adminMockFreezeCommand(
      command({ bidSessionId: '01HZZ0000000000000OTHERCM' }),
    );
    expect(mismatch).toEqual({
      kind: 'rejected',
      commandId,
      code: 'SESSION_ID_MISMATCH',
      currentSeq: 7,
    });
    expect(
      [...storage.data.keys()].filter((key) => key.startsWith(`cmd:${sessionId}:`)),
    ).toHaveLength(0);
  });

  it('binds the D1 session id to a named DO instead of its opaque durable id', async () => {
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
    const namedDo = new BidSessionDO(
      makeStateMock(opaqueDoId, namedStorage, sessionId),
      (doInstance as unknown as { env: WorkerEnv }).env,
    );

    const result = await namedDo.adminMockFreezeCommand(command());

    expect(result.kind).toBe('accepted');
    expect((await namedStorage.get<BidSessionState>(`bs:${opaqueDoId}:state`))?.lastSeq).toBe(8);
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
  });

  it('does not expose private command receipts through the state snapshot', async () => {
    await doInstance.adminMockFreezeCommand(command());

    const res = await doInstance.fetch(new Request('https://do/snapshot'));
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('commandReceipts');
    expect(snapshot).not.toHaveProperty('reason');
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
  });

  it('does not advance state or leave a receipt when the DO-local transaction fails', async () => {
    storage.failNextTransaction();

    await expect(doInstance.adminMockFreezeCommand(command())).rejects.toThrow(
      'simulated local transaction failure',
    );
    expect(await storage.get<BidSessionState>(`bs:${sessionId}:state`)).toEqual(initialState);
    expect(
      [...storage.data.keys()].filter((key) => key.startsWith(`cmd:${sessionId}:`)),
    ).toHaveLength(0);
  });
});
