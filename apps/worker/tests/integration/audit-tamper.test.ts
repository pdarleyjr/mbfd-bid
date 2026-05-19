// Plan 08 Task 11 — Tamper integration test (D9 legal-record guarantee).
//
// Builds a clean 250-event chain, then iterates 20 random single-byte
// mutations and asserts the verifier rejects every one. Also covers two
// shaped failure modes — last-chunk truncation and middle-chunk deletion.

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
  // The verifier doesn't read this DB — it streams from R2 — but the emitter
  // does, to compute the next chunk_seq + prev_chunk_sha256 link. A noop DB
  // would cause every chunk to overwrite the same R2 key (chunks/0001.jsonl).
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
  bid_session_id: '01HTAMPER',
  action: 'pick',
  actor_type: 'member',
  actor_id: 42,
  target_kind: 'position',
  target_id: `A${100 + (seq % 200)}`,
  created_at: '2026-09-22T14:00:00Z',
});

describe('audit chain tamper detection (D9 legal-record guarantee)', () => {
  let priv: Uint8Array;
  let pub: Uint8Array;

  beforeAll(async () => {
    priv = ed.utils.randomPrivateKey();
    pub = await ed.getPublicKeyAsync(priv);
  });

  async function buildCleanChain(): Promise<FakeR2> {
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
    await em.drainSession('01HTAMPER');
    return r2;
  }

  it('clean chain verifies ok', async () => {
    const r2 = await buildCleanChain();
    const res = await verifyChain(r2, '01HTAMPER', 2026);
    expect(res.ok).toBe(true);
    expect(res.total_events_verified).toBe(250);
  });

  it.each(Array.from({ length: 20 }, (_, i) => i))(
    'random single-byte tamper run %i MUST fail verification',
    async (i) => {
      const r2 = await buildCleanChain();
      const keys = [...r2._objects.keys()];
      const tamperKey = keys[i % keys.length] as string;
      const original = r2._objects.get(tamperKey) as Uint8Array;
      const tampered = new Uint8Array(original);
      // Skip the first byte (object framing) and stay in the body.
      const offset = ((i * 7919) % (tampered.length - 1)) + 1;
      tampered[offset] = ((tampered[offset] as number) ^ 0x01) & 0xff;
      r2._objects.set(tamperKey, tampered);
      const res = await verifyChain(r2, '01HTAMPER', 2026);
      expect(res.ok).toBe(false);
      expect(res.failed_at_chunk).toBeDefined();
    },
    20_000,
  );

  it('truncating bytes off the last chunk fails verification', async () => {
    // Truncate past the trailing newline into the body so the last event
    // is corrupt — a single-byte tail truncation only removes the LF that
    // `txt.trim()` discards anyway, which is intentional behavior.
    const r2 = await buildCleanChain();
    const keys = [...r2._objects.keys()].sort();
    const lastKey = keys[keys.length - 1] as string;
    const original = r2._objects.get(lastKey) as Uint8Array;
    r2._objects.set(lastKey, original.subarray(0, original.length - 10));
    const res = await verifyChain(r2, '01HTAMPER', 2026);
    expect(res.ok).toBe(false);
  });

  it('deleting the middle chunk fails verification with missing-chunk reason', async () => {
    const r2 = await buildCleanChain();
    r2._objects.delete('2026/01HTAMPER/chunks/0002.jsonl');
    const res = await verifyChain(r2, '01HTAMPER', 2026);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing/i);
  });
});
