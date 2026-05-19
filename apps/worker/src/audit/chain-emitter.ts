// Plan 08 Task 8 — Public audit emitter for the BidSession DO.
//
// Ties together: chunker → hash chain → signer → R2 upload → D1 audit_chunks
// row → D1 audit_chain_state update → D1 audit_log.chunk_seq backfill.
//
// One instance per Worker isolate. State lives entirely in:
//   - in-memory chunker map (process-local; lost on eviction is OK because the
//     events are still in D1 audit_log and will be re-emitted from there).
//   - audit_chain_state row (durable seq + last hash + buffer-started-at).
//
// IMPORTANT — Plan 08 §D10: R2 is the canonical legal record. If the R2 put
// throws, the caller (the DO commit path) MUST propagate the error and reject
// the pick — emit() throws to make that contract explicit.

import type { R2Bucket } from '@cloudflare/workers-types';
import type { AuditEvent } from '@mbfd/shared';

import { computeChunkHash } from './hash-chain.js';
import { JsonlChunker } from './jsonl-chunker.js';
import { signChunk } from './signer.js';
import type { ChunkFlush } from './types.js';

export interface ChainDb {
  insertChunk(row: {
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
  }): Promise<void>;

  upsertState(
    bidSessionId: string,
    patch: { nextSeq: number; lastChunkSha256: string; pendingBufferStartedAt: Date | null },
  ): Promise<void>;

  loadState(
    bidSessionId: string,
  ): Promise<{ nextSeq: number; lastChunkSha256: string | null } | null>;

  backfillRowIndexes(bidSessionId: string, chunkSeq: number, eventSeqs: number[]): Promise<void>;
}

export interface ChainEmitterDeps {
  r2: R2Bucket;
  db: ChainDb;
  privKey: string;
  pubKey: string;
  /** Bid year — first segment of the R2 object key. */
  year: number;
  /** Clock injection point (so tests can advance time deterministically). */
  now: () => number;
}

/**
 * Public audit emitter consumed by the BidSession DO.
 *
 *   await emitter.emit(event)         ← from DO commit; may trigger flush
 *   await emitter.flushStale()        ← from 30s cron tick
 *   await emitter.drainSession(sid)   ← on session_complete / day_end
 */
export class ChainEmitter {
  private readonly chunkers = new Map<string, JsonlChunker>();

  constructor(private readonly deps: ChainEmitterDeps) {}

  async emit(event: AuditEvent): Promise<void> {
    const existing = this.chunkers.get(event.bid_session_id);
    const c = existing ?? new JsonlChunker();
    if (!existing) this.chunkers.set(event.bid_session_id, c);
    const flush = c.add(event, this.deps.now());
    if (flush) await this.uploadChunk(event.bid_session_id, flush);
  }

  /** Called from cron. Flushes any session whose buffer is older than 30s. */
  async flushStale(): Promise<number> {
    let n = 0;
    const now = this.deps.now();
    for (const [sid, c] of this.chunkers) {
      const flush = c.flushIfStale(now);
      if (flush) {
        await this.uploadChunk(sid, flush);
        n++;
      }
    }
    return n;
  }

  /** Force-drain a session (e.g. on session_complete). */
  async drainSession(sid: string): Promise<void> {
    const c = this.chunkers.get(sid);
    if (!c) return;
    const flush = c.drain('session_end');
    if (flush) await this.uploadChunk(sid, flush);
    this.chunkers.delete(sid);
  }

  /** Diagnostic — sessions with pending events. */
  pendingSessions(): string[] {
    return [...this.chunkers].filter(([, c]) => c.hasPending()).map(([sid]) => sid);
  }

  // ─── internal ────────────────────────────────────────────────────────────

  private async uploadChunk(sid: string, flush: ChunkFlush): Promise<void> {
    const state = await this.deps.db.loadState(sid);
    const seq = state?.nextSeq ?? 1;
    const prev = state?.lastChunkSha256 ?? null;

    const events = flush.events;
    const first = events[0] as AuditEvent;
    const last = events[events.length - 1] as AuditEvent;
    const sha = computeChunkHash(prev, events);
    const sig = await signChunk(sha, this.deps.privKey);
    const signedAt = new Date(this.deps.now());

    const header = {
      chunk_seq: seq,
      prev_chunk_sha256: prev,
      events_in_chunk: events.length,
      min_seq: first.seq,
      max_seq: last.seq,
      signature: sig,
      pubkey: this.deps.pubKey,
      signed_at: signedAt.toISOString(),
    };

    const lines = [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))];
    const body = `${lines.join('\n')}\n`;
    const key = this.r2KeyFor(sid, seq);

    // The R2 put is the canonical legal record (§D10). If it throws, we
    // propagate — the DO commit handler turns that into a 500/rejected pick.
    await this.deps.r2.put(key, body, {
      httpMetadata: { contentType: 'application/jsonl' },
    });

    await this.deps.db.insertChunk({
      bidSessionId: sid,
      seq,
      r2Key: key,
      sha256: sha,
      prevSha256: prev,
      signatureB64u: sig,
      pubkeyB64u: this.deps.pubKey,
      eventsInChunk: events.length,
      minSeq: first.seq,
      maxSeq: last.seq,
      signedAt,
    });

    await this.deps.db.upsertState(sid, {
      nextSeq: seq + 1,
      lastChunkSha256: sha,
      pendingBufferStartedAt: null,
    });

    await this.deps.db.backfillRowIndexes(
      sid,
      seq,
      events.map((e) => e.seq),
    );
  }

  private r2KeyFor(sid: string, seq: number): string {
    const padded = String(seq).padStart(4, '0');
    return `${this.deps.year}/${sid}/chunks/${padded}.jsonl`;
  }
}
