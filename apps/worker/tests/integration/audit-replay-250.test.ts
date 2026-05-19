// Plan 08 Task 12 — 250-event clean replay performance test.
//
// Asserts a full 250-pick session produces exactly 3 chunks (100 + 100 + 50),
// verifies cleanly, and the verifyChain call completes in under 1 s.

import type { R2Bucket } from '@cloudflare/workers-types';
import type { AuditEvent } from '@mbfd/shared';
import * as ed from '@noble/ed25519';
import { beforeAll, describe, expect, it } from 'vitest';

import { type ChainDb, ChainEmitter } from '../../src/audit/chain-emitter.js';
import { encodeKey } from '../../src/audit/signer.js';
import { verifyChain } from '../../src/audit/verifier.js';

interface FakeR2 extends R2Bucket {
  _objects: Map<string, Uint8Array>;
}

function inMemR2(): FakeR2 {
  const objects = new Map<string, Uint8Array>();
  return {
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
  } as unknown as FakeR2;
}

function statefulDb(): ChainDb {
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

const mkEvent = (seq: number): AuditEvent => ({
  seq,
  bid_session_id: '01HREP',
  action: 'pick',
  actor_type: 'member',
  actor_id: (seq % 280) + 1,
  target_kind: 'position',
  target_id: `A${100 + (seq % 230)}`,
  created_at: '2026-09-22T14:00:00Z',
});

describe('audit chain 250-event replay', () => {
  let priv: Uint8Array;
  let pub: Uint8Array;

  beforeAll(async () => {
    priv = ed.utils.randomPrivateKey();
    pub = await ed.getPublicKeyAsync(priv);
  });

  it('produces exactly 3 chunks (100 + 100 + 50) and verifies clean', async () => {
    const r2 = inMemR2();
    const em = new ChainEmitter({
      r2,
      db: statefulDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
    for (let i = 1; i <= 250; i++) await em.emit(mkEvent(i));
    await em.drainSession('01HREP');
    const keys = [...r2._objects.keys()];
    expect(keys).toHaveLength(3);
    const res = await verifyChain(r2, '01HREP', 2026);
    expect(res.ok).toBe(true);
    expect(res.total_events_verified).toBe(250);
  });

  it('verify completes in under 1000ms', async () => {
    const r2 = inMemR2();
    const em = new ChainEmitter({
      r2,
      db: statefulDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
    for (let i = 1; i <= 250; i++) await em.emit(mkEvent(i));
    await em.drainSession('01HREP');
    const t0 = Date.now();
    const res = await verifyChain(r2, '01HREP', 2026);
    const elapsed = Date.now() - t0;
    expect(res.ok).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
