// W34 — DO alarm-based audit chain flush.
//
// Verifies that the BidSession DO's `alarm()` method flushes any stale
// audit chunks via the ChainEmitter when invoked. The watch item replaces
// the Worker-level 1-minute cron (which can't reach per-DO emitter state)
// with a DO alarm scheduled inside the DO each time `emitter.emit(...)`
// runs.
//
// Test plan:
//   1. Buffer 50 events into a real ChainEmitter (under threshold so no
//      threshold flush triggers).
//   2. Advance the injected clock past 30s.
//   3. Call emitter.flushStale() — assert exactly one chunk is written to
//      the in-memory R2 stub.
//
// We DO NOT spin up a full DO via Miniflare because @cloudflare/vitest-pool
// is not wired for this project; the contract under test is the
// `flushStale` behavior that the DO's `alarm()` callback delegates to.

import type { R2Bucket } from '@cloudflare/workers-types';
import type { AuditEvent } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';

import { type ChainDb, ChainEmitter } from '../../src/audit/chain-emitter.js';

function makeR2Stub(): { put: ReturnType<typeof vi.fn>; bucket: R2Bucket } {
  const put = vi.fn().mockResolvedValue(undefined);
  const bucket = {
    put,
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
  } as unknown as R2Bucket;
  return { put, bucket };
}

function makeChainDbStub(): { db: ChainDb; inserts: number; backfills: number; state: number } {
  const counters = { inserts: 0, backfills: 0, state: 0 };
  return {
    inserts: counters.inserts,
    backfills: counters.backfills,
    state: counters.state,
    db: {
      async insertChunk() {
        counters.inserts += 1;
      },
      async upsertState() {
        counters.state += 1;
      },
      async loadState() {
        return { nextSeq: 1, lastChunkSha256: null };
      },
      async backfillRowIndexes() {
        counters.backfills += 1;
      },
    },
  };
}

function makeAuditEvent(seq: number): AuditEvent {
  return {
    seq,
    bid_session_id: '01HZZ0000000000000000FLUSH01',
    action: 'pick',
    actor_type: 'member',
    actor_id: 42,
    target_kind: 'bid',
    target_id: `bid-${seq}`,
    before_state: null,
    after_state: null,
    reason: null,
    ai_advisory_id: null,
    client_meta: null,
    created_at: new Date(seq * 1000).toISOString(),
  };
}

describe('DO alarm-based audit chain flush (W34)', () => {
  it('flushStale writes exactly one chunk when buffer ages past 30s', async () => {
    const { put, bucket } = makeR2Stub();
    const stub = makeChainDbStub();
    let nowMs = 1_000_000;
    const emitter = new ChainEmitter({
      r2: bucket,
      db: stub.db,
      privKey: 'a'.repeat(43), // 32 bytes base64url
      pubKey: 'b'.repeat(43),
      year: 2026,
      now: () => nowMs,
    });

    // Buffer 50 events — well under the 100-event threshold.
    for (let i = 1; i <= 50; i++) {
      await emitter.emit(makeAuditEvent(i));
    }
    expect(put).toHaveBeenCalledTimes(0); // no threshold flush yet

    // Advance time past the 30s timeout.
    nowMs += 30_001;
    const flushed = await emitter.flushStale();
    expect(flushed).toBe(1);

    // One R2 put with 50 events + a header line.
    expect(put).toHaveBeenCalledTimes(1);
    const calls = put.mock.calls as Array<[string, string]>;
    const [r2Key, body] = calls[0] ?? [];
    expect(r2Key).toContain('2026/01HZZ0000000000000000FLUSH01/chunks/');
    expect(typeof body).toBe('string');
    expect(String(body).split('\n').length).toBeGreaterThanOrEqual(51); // header + 50 events
  });

  it('flushStale returns 0 when no buffer has aged past 30s', async () => {
    const { put, bucket } = makeR2Stub();
    const stub = makeChainDbStub();
    let nowMs = 1_000_000;
    const emitter = new ChainEmitter({
      r2: bucket,
      db: stub.db,
      privKey: 'a'.repeat(43),
      pubKey: 'b'.repeat(43),
      year: 2026,
      now: () => nowMs,
    });

    for (let i = 1; i <= 5; i++) await emitter.emit(makeAuditEvent(i));

    nowMs += 1000; // only 1s elapsed
    const flushed = await emitter.flushStale();
    expect(flushed).toBe(0);
    expect(put).toHaveBeenCalledTimes(0);
  });

  it('flushStale + re-emit + flushStale produces two chunks', async () => {
    const { put, bucket } = makeR2Stub();
    const stub = makeChainDbStub();
    let nowMs = 1_000_000;
    let nextSeq = 1;
    const emitter = new ChainEmitter({
      r2: bucket,
      db: {
        ...stub.db,
        async loadState() {
          return { nextSeq, lastChunkSha256: null };
        },
        async upsertState(_sid, patch) {
          nextSeq = patch.nextSeq;
        },
      },
      privKey: 'a'.repeat(43),
      pubKey: 'b'.repeat(43),
      year: 2026,
      now: () => nowMs,
    });

    for (let i = 1; i <= 10; i++) await emitter.emit(makeAuditEvent(i));
    nowMs += 30_001;
    expect(await emitter.flushStale()).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);

    for (let i = 11; i <= 20; i++) await emitter.emit(makeAuditEvent(i));
    nowMs += 30_001;
    expect(await emitter.flushStale()).toBe(1);
    expect(put).toHaveBeenCalledTimes(2);
  });
});
