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

const mkEvent = (seq: number): AuditEvent => ({
  seq,
  bid_session_id: '01HF3',
  action: 'pick',
  actor_type: 'member',
  actor_id: 42,
  target_kind: 'position',
  target_id: `A${100 + seq}`,
  created_at: '2026-09-22T14:00:00Z',
});

describe('verifyChain', () => {
  let priv: Uint8Array;
  let pub: Uint8Array;

  beforeAll(async () => {
    priv = ed.utils.randomPrivateKey();
    pub = await ed.getPublicKeyAsync(priv);
  });

  function newEmitter(r2: FakeR2): ChainEmitter {
    return new ChainEmitter({
      r2,
      db: inMemDb(),
      privKey: encodeKey(priv),
      pubKey: encodeKey(pub),
      year: 2026,
      now: () => Date.now(),
    });
  }

  it('reports ok=true on a clean 250-event chain', async () => {
    const r2 = inMemR2();
    const em = newEmitter(r2);
    for (let i = 1; i <= 250; i++) await em.emit(mkEvent(i));
    await em.drainSession('01HF3');
    const res = await verifyChain(r2, '01HF3', 2026);
    expect(res.ok).toBe(true);
    expect(res.last_verified_seq).toBe(3); // 100+100+50
    expect(res.total_events_verified).toBe(250);
    expect(res.reason).toBeUndefined();
  });

  it('reports ok=false with chunk_seq + reason when a chunk byte is mutated', async () => {
    const r2 = inMemR2();
    const em = newEmitter(r2);
    for (let i = 1; i <= 100; i++) await em.emit(mkEvent(i));
    const key = '2026/01HF3/chunks/0001.jsonl';
    const original = r2._objects.get(key);
    expect(original).toBeDefined();
    const tampered = new Uint8Array(original as Uint8Array);
    tampered[tampered.length - 50] = ((tampered[tampered.length - 50] as number) ^ 0x01) & 0xff;
    r2._objects.set(key, tampered);
    const res = await verifyChain(r2, '01HF3', 2026);
    expect(res.ok).toBe(false);
    expect(res.failed_at_chunk).toBe(1);
    expect(res.reason).toMatch(/signature|hash|tamper/i);
  });

  it('reports ok=false when prev_chunk_sha256 link is broken', async () => {
    const r2 = inMemR2();
    const em = newEmitter(r2);
    for (let i = 1; i <= 200; i++) await em.emit(mkEvent(i));
    const key2 = '2026/01HF3/chunks/0002.jsonl';
    const blob = r2._objects.get(key2);
    expect(blob).toBeDefined();
    const txt = new TextDecoder().decode(blob as Uint8Array);
    const lines = txt.trim().split('\n');
    const head = JSON.parse(lines[0] as string);
    head.prev_chunk_sha256 = 'f'.repeat(64);
    const newText = `${[JSON.stringify(head), ...lines.slice(1)].join('\n')}\n`;
    r2._objects.set(key2, new TextEncoder().encode(newText));
    const res = await verifyChain(r2, '01HF3', 2026);
    expect(res.ok).toBe(false);
    expect(res.failed_at_chunk).toBe(2);
    expect(res.reason).toMatch(/prev/i);
  });

  it('reports ok=false when a chunk is missing', async () => {
    const r2 = inMemR2();
    const em = newEmitter(r2);
    for (let i = 1; i <= 300; i++) await em.emit(mkEvent(i));
    r2._objects.delete('2026/01HF3/chunks/0002.jsonl');
    const res = await verifyChain(r2, '01HF3', 2026);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing/i);
  });

  it('reports ok=true with empty result when no chunks exist', async () => {
    const r2 = inMemR2();
    const res = await verifyChain(r2, '01HF3', 2026);
    expect(res.ok).toBe(true);
    expect(res.last_verified_seq).toBe(0);
    expect(res.total_events_verified).toBe(0);
  });
});
