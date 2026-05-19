import type { R2Bucket } from '@cloudflare/workers-types';
import type { AuditEvent } from '@mbfd/shared';
import * as ed from '@noble/ed25519';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { type ChainDb, ChainEmitter } from '../../src/audit/chain-emitter.js';
import { computeChunkHash } from '../../src/audit/hash-chain.js';
import { encodeKey, verifyChunkSignature } from '../../src/audit/signer.js';

interface MockR2 {
  put: ReturnType<typeof vi.fn>;
  objects: Map<string, Uint8Array>;
}

function mockR2(): MockR2 {
  const objects = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, body: ArrayBuffer | Uint8Array | string) => {
    const bytes =
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : body instanceof Uint8Array
          ? body
          : new Uint8Array(body);
    objects.set(key, bytes);
  });
  return { put, objects };
}

interface MockDb extends ChainDb {
  chunks: Array<{
    bidSessionId: string;
    seq: number;
    r2Key: string;
    sha256: string;
    prevSha256: string | null;
    signatureB64u: string;
    pubkeyB64u: string;
    eventsInChunk: number;
    minSeq: number;
    maxSeq: number;
    signedAt: Date;
  }>;
}

function mockDb(): MockDb {
  const chunks: MockDb['chunks'] = [];
  const stateBySession = new Map<string, { nextSeq: number; lastChunkSha256: string | null }>();
  return {
    chunks,
    insertChunk: vi.fn(async (row) => {
      chunks.push(row);
    }),
    upsertState: vi.fn(async (sid: string, patch) => {
      const prev = stateBySession.get(sid) ?? { nextSeq: 1, lastChunkSha256: null };
      stateBySession.set(sid, {
        nextSeq: patch.nextSeq,
        lastChunkSha256: patch.lastChunkSha256 ?? prev.lastChunkSha256,
      });
    }),
    loadState: vi.fn(async (sid: string) => stateBySession.get(sid) ?? null),
    backfillRowIndexes: vi.fn(async () => {}),
  };
}

const mkEvent = (seq: number): AuditEvent => ({
  seq,
  bid_session_id: '01HF3',
  action: 'pick',
  actor_type: 'member',
  actor_id: 42,
  target_id: `A${100 + seq}`,
  target_kind: 'position',
  created_at: '2026-09-22T14:00:00Z',
});

let priv: Uint8Array;
let pub: Uint8Array;

beforeAll(async () => {
  priv = ed.utils.randomPrivateKey();
  pub = await ed.getPublicKeyAsync(priv);
});

function newEmitter(r2: MockR2, db: MockDb): ChainEmitter {
  return new ChainEmitter({
    r2: { put: r2.put } as unknown as R2Bucket,
    db,
    privKey: encodeKey(priv),
    pubKey: encodeKey(pub),
    year: 2026,
    now: () => Date.now(),
  });
}

describe('ChainEmitter', () => {
  it('emits events into a buffer and flushes at threshold', async () => {
    const r2 = mockR2();
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 100; i++) await em.emit(mkEvent(i));
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(db.insertChunk).toHaveBeenCalledTimes(1);
  });

  it('R2 key matches <year>/<session>/chunks/<padded-seq>.jsonl', async () => {
    const r2 = mockR2();
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 100; i++) await em.emit(mkEvent(i));
    const keys = Array.from(r2.objects.keys());
    expect(keys[0]).toBe('2026/01HF3/chunks/0001.jsonl');
  });

  it('uploaded chunk is parseable JSONL with a header line + N event lines', async () => {
    const r2 = mockR2();
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 100; i++) await em.emit(mkEvent(i));
    const blob = r2.objects.get('2026/01HF3/chunks/0001.jsonl');
    expect(blob).toBeDefined();
    const text = new TextDecoder().decode(blob as Uint8Array);
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(101); // 1 header + 100 events
    const header = JSON.parse(lines[0] as string);
    expect(header.chunk_seq).toBe(1);
    expect(header.events_in_chunk).toBe(100);
    expect(header.min_seq).toBe(1);
    expect(header.max_seq).toBe(100);
  });

  it('chunk signature verifies under the public key', async () => {
    const r2 = mockR2();
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 100; i++) await em.emit(mkEvent(i));
    const text = new TextDecoder().decode(
      r2.objects.get('2026/01HF3/chunks/0001.jsonl') as Uint8Array,
    );
    const lines = text.trim().split('\n');
    const header = JSON.parse(lines[0] as string);
    const events: AuditEvent[] = lines.slice(1).map((l: string) => JSON.parse(l));
    const expectedHash = computeChunkHash(null, events);
    expect(await verifyChunkSignature(expectedHash, header.signature, header.pubkey)).toBe(true);
  });

  it('second chunk references the first chunk hash as prev_chunk_sha256', async () => {
    const r2 = mockR2();
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 200; i++) await em.emit(mkEvent(i));
    const c1 = new TextDecoder().decode(
      r2.objects.get('2026/01HF3/chunks/0001.jsonl') as Uint8Array,
    );
    const c2 = new TextDecoder().decode(
      r2.objects.get('2026/01HF3/chunks/0002.jsonl') as Uint8Array,
    );
    const h1 = JSON.parse((c1.split('\n')[0] as string) ?? '{}');
    const h2 = JSON.parse((c2.split('\n')[0] as string) ?? '{}');
    expect(h2.prev_chunk_sha256).toBe(db.chunks[0]?.sha256);
    expect(h1.prev_chunk_sha256).toBe(null);
  });

  it('propagates R2 errors so the DO can reject the pick (§D10)', async () => {
    const r2 = mockR2();
    r2.put.mockImplementationOnce(async () => {
      throw new Error('R2 unavailable');
    });
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 99; i++) await em.emit(mkEvent(i));
    await expect(em.emit(mkEvent(100))).rejects.toThrow(/R2 unavailable/);
  });

  it('drainSession() forces a flush of partial buffer (session_end)', async () => {
    const r2 = mockR2();
    const db = mockDb();
    const em = newEmitter(r2, db);
    for (let i = 1; i <= 3; i++) await em.emit(mkEvent(i));
    expect(r2.put).toHaveBeenCalledTimes(0);
    await em.drainSession('01HF3');
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(em.pendingSessions()).toEqual([]);
  });
});
