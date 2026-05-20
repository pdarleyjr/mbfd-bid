import type { JwtPayload } from '@mbfd/shared';
import * as ed from '@noble/ed25519';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import { type ChainDb, ChainEmitter } from '../../src/audit/chain-emitter.js';
import { encodeKey } from '../../src/audit/signer.js';
import { signJwt } from '../../src/lib/jwt.js';
import adminAudit from '../../src/routes/admin/audit.js';
import type { WorkerEnv } from '../../src/types/env.js';

type FakeR2 = WorkerEnv['R2_AUDIT'] & { _objects: Map<string, Uint8Array> };

function inMemR2(): FakeR2 {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    _objects: objects,
    async put(key: string, body: string | ArrayBuffer | Uint8Array) {
      const bytes =
        typeof body === 'string'
          ? new TextEncoder().encode(body)
          : body instanceof Uint8Array
            ? body
            : new Uint8Array(body);
      objects.set(key, bytes);
    },
    async get(key: string) {
      const v = objects.get(key);
      if (!v) return null;
      return {
        arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
        text: async () => new TextDecoder().decode(v),
      };
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { objects: keys.map((key) => ({ key })) };
    },
  };
  return bucket as unknown as FakeR2;
}

function inMemDb(): ChainDb {
  const state = new Map<string, { nextSeq: number; lastChunkSha256: string | null }>();
  return {
    async insertChunk() {},
    async upsertState(sid, patch) {
      state.set(sid, {
        nextSeq: patch.nextSeq,
        lastChunkSha256: patch.lastChunkSha256,
      });
    },
    async loadState(sid) {
      return state.get(sid) ?? null;
    },
    async backfillRowIndexes() {},
  };
}

function makeEnv(r2: FakeR2): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    PIN_HASH: 'x',
    PORTAL_BID_READER: 'tok',
    CF_AI_GATEWAY_URL: 'https://gateway.example.com/v1/x/mbfd-bid/anthropic',
    ANTHROPIC_API_KEY: 'sk-test',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AI_KV: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: r2,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    AI: {} as never,
    BROWSER: {} as never,
  };
}

async function adminJwt(env: WorkerEnv): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 0,
    emp: 'admin',
    role: 'admin',
    rank: 'CHIEF',
    first_name: 'A',
    last_name: 'B',
    fresh_auth_at: Math.floor(Date.now() / 1000),
  };
  return signJwt(payload, env.JWT_SIGNING_KEY);
}

function mkApp() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/audit', adminAudit);
}

let priv: Uint8Array;
let pub: Uint8Array;

beforeAll(async () => {
  priv = ed.utils.randomPrivateKey();
  pub = await ed.getPublicKeyAsync(priv);
});

describe('GET /api/admin/audit/verify-chain (Plan 08 Task 10)', () => {
  it('returns 401 without JWT', async () => {
    const env = makeEnv(inMemR2());
    const res = await mkApp().request('/api/admin/audit/verify-chain?session_id=01HF3', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns 400 when session_id missing', async () => {
    const env = makeEnv(inMemR2());
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/audit/verify-chain',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 + ok:true for an empty (no chunks) session', async () => {
    const env = makeEnv(inMemR2());
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/audit/verify-chain?session_id=01HF3&year=2026',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 + ok:true for a clean 100-event chain', async () => {
    const r2 = inMemR2();
    const env = makeEnv(r2);
    const em = new ChainEmitter({
      r2,
      db: inMemDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
    for (let i = 1; i <= 100; i++) {
      await em.emit({
        seq: i,
        bid_session_id: '01HF3',
        action: 'pick',
        actor_type: 'member',
        actor_id: 1,
        target_kind: 'position',
        target_id: `A${100 + i}`,
        created_at: '2026-09-22T14:00:00Z',
      });
    }
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/audit/verify-chain?session_id=01HF3&year=2026',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; total_events_verified: number };
    expect(body.ok).toBe(true);
    expect(body.total_events_verified).toBe(100);
  });

  it('returns 422 + ok:false after tamper', async () => {
    const r2 = inMemR2();
    const env = makeEnv(r2);
    const em = new ChainEmitter({
      r2,
      db: inMemDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
    for (let i = 1; i <= 100; i++) {
      await em.emit({
        seq: i,
        bid_session_id: '01HF3',
        action: 'pick',
        actor_type: 'member',
        actor_id: 1,
        target_id: `A${100 + i}`,
        target_kind: 'position',
        created_at: '2026-09-22T14:00:00Z',
      });
    }
    const key = '2026/01HF3/chunks/0001.jsonl';
    const blob = (r2 as FakeR2)._objects.get(key) as Uint8Array;
    const tampered = new Uint8Array(blob);
    tampered[tampered.length - 50] = ((tampered[tampered.length - 50] as number) ^ 0x01) & 0xff;
    (r2 as FakeR2)._objects.set(key, tampered);
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/audit/verify-chain?session_id=01HF3&year=2026',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; failed_at_chunk: number };
    expect(body.ok).toBe(false);
    expect(body.failed_at_chunk).toBe(1);
  });
});
