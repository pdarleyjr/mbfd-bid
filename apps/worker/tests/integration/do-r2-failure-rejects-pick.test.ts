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

import type { R2Bucket } from '@cloudflare/workers-types';
import * as ed from '@noble/ed25519';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { encodeKey } from '../../src/audit/signer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

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
  let h: TestD1;
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
    h = await setupTestD1();
    const capturedAt = Date.now();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      `INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
     VALUES ('${sessionId}', 2026, ${capturedAt}, 'position_bid', 180, 2, 1);`,
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');",
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          v: 1,
          ruleBookVersion: '2026.1',
          positionTemplateVersion: '2026.1',
          capturedAtMs: capturedAt,
          members: [
            {
              memberId: 42,
              pool: 'FF',
              rscSeniority: 42,
              rankSeniority: null,
              exclusionReason: null,
              authoritativeAssignmentId: null,
            },
          ],
        }),
        capturedAt,
      ],
    );

    storage = makeStorage();
    state = makeStateMock(sessionId, storage);
    env = {
      ...h.env,
      JWT_SIGNING_KEY: 'k'.repeat(64),
      BID_SESSION: {} as never,
      AUDIT_SIGNING_PRIVKEY: encodeKey(priv),
      AUDIT_SIGNING_PUBKEY: encodeKey(pub),
      R2_AUDIT: makeBrokenR2(),
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

  afterEach(async () => {
    storage.data.clear();
    await teardownTestD1(h);
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
