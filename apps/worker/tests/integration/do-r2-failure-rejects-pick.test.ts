// W36 — DO-level test: when R2 chain emit fails, the DO MUST reject the
// pick with AUDIT_UNAVAILABLE and MUST NOT advance state (§D10 strict
// variant).
//
// We construct the DO directly with stub `DurableObjectState` and `WorkerEnv`
// shaped objects. The R2 binding's `.put()` throws on every call. We then
// exercise `adminForcePick` (the admin path that runs the same strict
// `emitPickToChain` contract as the WS submit path) and assert:
//
//   1. The handler returns `{ ok: false }` — i.e. the operation failed.
//   2. The persisted DO state did NOT advance — `currentPhase` stays in its
//      pre-call value, `fills` is empty, `bidOrder` cursor is unchanged.
//
// This is the contract documented in `src/durable/bid-session.ts` around
// `emitPickToChain` and the `emitter.emit` call path that ends in the
// "force-pick rejected — audit chain unavailable" log line.

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import * as ed from '@noble/ed25519';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { encodeKey } from '../../src/audit/signer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import type { WorkerEnv } from '../../src/types/env.js';

interface Storage {
  data: Map<string, unknown>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
  setAlarm(when: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAll(): Promise<void>;
}

function makeStorage(): Storage {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
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
      const out = new Map<string, T>();
      for (const [k, v] of data) if (k.startsWith(prefix)) out.set(k, v as T);
      return out;
    },
    async setAlarm(when: number): Promise<void> {
      alarm = when;
    },
    async getAlarm(): Promise<number | null> {
      return alarm;
    },
    async deleteAll(): Promise<void> {
      data.clear();
      alarm = null;
    },
  };
}

function makeStateMock(id: string, storage: Storage): DurableObjectState {
  return {
    id: { toString: () => id, equals: () => false, name: id } as unknown as DurableObjectId,
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

function makeBrokenR2(): R2Bucket {
  return {
    async put() {
      throw new Error('R2 write failed (simulated)');
    },
    async get() {
      return null;
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false };
    },
    async head() {
      return null;
    },
  } as unknown as R2Bucket;
}

function makeStubDb(): D1Database {
  // The DO's writeAudit catches D1 errors, so a no-op-friendly stub is fine.
  // The audit chain DB (makeChainDb) only matters when emitter actually flushes
  // a chunk — and here R2.put throws BEFORE that, so we never reach the D1
  // chain write.
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

let priv: Uint8Array;
let pub: Uint8Array;

beforeAll(async () => {
  priv = ed.utils.randomPrivateKey();
  pub = await ed.getPublicKeyAsync(priv);
});

describe('BidSessionDO rejects pick when R2 chain emit fails (W36)', () => {
  let storage: Storage;
  let state: DurableObjectState;
  let env: WorkerEnv;
  let doInstance: BidSessionDO;
  let initialState: BidSessionState;
  const sessionId = '01HZZ0000000000000000W36';

  // Pre-fill the per-isolate ChainEmitter buffer to 99 events. The 100th
  // emit() the DO drives in this test will then trigger a flush — which
  // calls R2.put() — which throws — which the DO MUST catch and turn into
  // a rejected pick.
  async function preFillBufferToThreshold(): Promise<void> {
    // Force the emitter to lazily construct first.
    const _emitter = (doInstance as unknown as { getEmitter(): unknown }).getEmitter();
    if (!_emitter) throw new Error('emitter not constructed (env misconfigured)');
    const em = _emitter as {
      emit(e: unknown): Promise<void>;
    };
    for (let i = 1; i <= 99; i++) {
      await em.emit({
        seq: i,
        bid_session_id: sessionId,
        action: 'pick',
        actor_type: 'member',
        actor_id: 42,
        target_kind: 'position',
        target_id: `A${100 + i}`,
        before_state: null,
        after_state: null,
        reason: null,
        ai_advisory_id: null,
        client_meta: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  beforeEach(async () => {
    storage = makeStorage();
    state = makeStateMock(sessionId, storage);
    env = {
      ENV: 'staging',
      PORTAL_BASE_URL: 'https://portal.test',
      JWT_SIGNING_KEY: 'k'.repeat(64),
      PIN_HASH: '$2b$12$placeholder',
      PORTAL_BID_READER: 'tok',
      CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/test/mbfd-bid/anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
      AI_BUDGET_CAP_CENTS: 2500,
      AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
      DB: makeStubDb(),
      KV: {} as never,
      AI_KV: {} as never,
      BID_SESSION: {} as never,
      AUDIT_SIGNING_PRIVKEY: encodeKey(priv),
      AUDIT_SIGNING_PUBKEY: encodeKey(pub),
      BROWSERLESS_TOKEN: '',
      R2_AUDIT: makeBrokenR2(),
      R2_EXPORTS: {} as never,
      PORTAL_QUEUE: {} as never,
      AI: {} as never,
      BROWSER: {} as never,
    };

    // Seed initial state: 1 bidder in position_bid phase, ready to be force-picked.
    initialState = {
      ...emptyBidSessionState(sessionId),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      turnStartedAtMs: Date.now(),
      turnTimerSeconds: 180,
      lastSeq: 0,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF' as const }],
    };
    // Persist the seed via the storage key used by loadBidSessionState.
    await storage.put(`bs:${sessionId}:state`, initialState);

    doInstance = new BidSessionDO(state, env);
  });

  afterEach(() => {
    storage.data.clear();
  });

  it('adminForcePick returns { ok: false } when R2.put throws on flush', async () => {
    await preFillBufferToThreshold();
    const result = await doInstance.adminForcePick({
      adminActorId: 0,
      targetMemberId: 42,
      positionId: 'A101',
      reason: 'simulated R2 outage 1',
    });
    expect(result.ok).toBe(false);
    expect(result.envelope).toBeUndefined();
  });

  it('DO state did not advance — position remains unfilled and lastSeq unchanged', async () => {
    await preFillBufferToThreshold();
    await doInstance.adminForcePick({
      adminActorId: 0,
      targetMemberId: 42,
      positionId: 'A101',
      reason: 'simulated R2 outage 2',
    });
    const persisted = (await storage.get<BidSessionState>(`bs:${sessionId}:state`)) ?? initialState;
    // No fill recorded for A101.
    expect(persisted.fills?.A101).toBeUndefined();
    // lastSeq did not advance.
    expect(persisted.lastSeq).toBe(initialState.lastSeq);
    // Still in position_bid phase, same bidder.
    expect(persisted.currentPhase).toBe('position_bid');
    expect(persisted.currentBidderId).toBe(42);
  });
});
