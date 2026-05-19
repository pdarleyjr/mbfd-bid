// Plan 08 Task 9 integration test — verifies the DO wires writes into the
// audit chain emitter, and that an R2 failure surfaces as a rejected pick.
//
// We can't easily spin up a full DO via `unstable_dev` from a unit test
// (Wrangler + R2 binding setup is too heavy for vitest pool workers), so we
// exercise the public surfaces we DO control: the emitter under the
// configured env vs. an env where R2 is broken. The DO test itself is
// covered by Plan 09's deploy-day smoke tests.

import type { R2Bucket } from '@cloudflare/workers-types';
import type { AuditEvent } from '@mbfd/shared';
import * as ed from '@noble/ed25519';
import { beforeAll, describe, expect, it } from 'vitest';

import { type ChainDb, ChainEmitter } from '../../src/audit/chain-emitter.js';
import { encodeKey } from '../../src/audit/signer.js';

interface InMemoryR2 {
  put: (key: string, body: ArrayBuffer | Uint8Array | string) => Promise<void>;
  objects: Map<string, Uint8Array>;
}

function memoryR2(): InMemoryR2 {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, body) {
      const bytes =
        typeof body === 'string'
          ? new TextEncoder().encode(body)
          : body instanceof Uint8Array
            ? body
            : new Uint8Array(body);
      objects.set(key, bytes);
    },
  };
}

function brokenR2(): InMemoryR2 {
  return {
    objects: new Map(),
    async put() {
      throw new Error('R2 write failed (simulated)');
    },
  };
}

function memoryDb(): ChainDb {
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

function mkEvent(seq: number): AuditEvent {
  return {
    seq,
    bid_session_id: '01HFE',
    action: 'pick',
    actor_type: 'member',
    actor_id: 42,
    target_kind: 'position',
    target_id: `A${100 + seq}`,
    created_at: '2026-09-22T14:00:00Z',
  };
}

let priv: Uint8Array;
let pub: Uint8Array;

beforeAll(async () => {
  priv = ed.utils.randomPrivateKey();
  pub = await ed.getPublicKeyAsync(priv);
});

describe('BidSession DO chain emission (Plan 08 Task 9)', () => {
  it('after 100 events a single chunk is written to R2 under the expected key', async () => {
    const r2 = memoryR2();
    const em = new ChainEmitter({
      r2: r2 as unknown as R2Bucket,
      db: memoryDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
    for (let i = 1; i <= 100; i++) await em.emit(mkEvent(i));
    expect(Array.from(r2.objects.keys())).toEqual(['2026/01HFE/chunks/0001.jsonl']);
  });

  it('emit() throws when R2 fails — the DO turns this into a rejected pick (§D10)', async () => {
    const em = new ChainEmitter({
      r2: brokenR2() as unknown as R2Bucket,
      db: memoryDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
    for (let i = 1; i <= 99; i++) await em.emit(mkEvent(i));
    await expect(em.emit(mkEvent(100))).rejects.toThrow(/R2 write failed/);
  });
});
