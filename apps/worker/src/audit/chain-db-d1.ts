// Plan 08 Task 9 — Drizzle adapter for the ChainEmitter's `ChainDb` interface.
//
// Sits between the emitter (which speaks an in-memory contract) and the D1
// driver. Keeping this adapter thin makes the emitter trivially testable
// (the test passes a `Map`-backed stub instead of D1).

import type { D1Database } from '@cloudflare/workers-types';
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db/index.js';
import { auditChainState, auditChunks, auditLog } from '../db/schema.js';
import type { ChainDb } from './chain-emitter.js';

export function makeChainDb(d1: D1Database): ChainDb {
  const db = getDb(d1);
  return {
    async insertChunk(row): Promise<void> {
      await db.insert(auditChunks).values({
        bidSessionId: row.bidSessionId,
        seq: row.seq,
        r2Key: row.r2Key,
        sha256: row.sha256,
        prevSha256: row.prevSha256,
        signatureB64u: row.signatureB64u,
        pubkeyB64u: row.pubkeyB64u,
        eventsInChunk: row.eventsInChunk,
        minSeq: row.minSeq,
        maxSeq: row.maxSeq,
        signedAt: row.signedAt,
      });
    },
    async upsertState(bidSessionId, patch): Promise<void> {
      await db
        .insert(auditChainState)
        .values({
          bidSessionId,
          nextSeq: patch.nextSeq,
          lastChunkSha256: patch.lastChunkSha256,
          pendingBufferStartedAt: patch.pendingBufferStartedAt,
        })
        .onConflictDoUpdate({
          target: auditChainState.bidSessionId,
          set: {
            nextSeq: patch.nextSeq,
            lastChunkSha256: patch.lastChunkSha256,
            pendingBufferStartedAt: patch.pendingBufferStartedAt,
          },
        });
    },
    async loadState(bidSessionId) {
      const r = await db
        .select()
        .from(auditChainState)
        .where(eq(auditChainState.bidSessionId, bidSessionId))
        .get();
      if (!r) return null;
      return {
        nextSeq: r.nextSeq,
        lastChunkSha256: r.lastChunkSha256,
      };
    },
    async backfillRowIndexes(bidSessionId, chunkSeq, eventSeqs): Promise<void> {
      // Composite predicate: same session + matching seq. Per-row updates are
      // fine here because the chunk size is bounded (≤ 100) and this is async
      // bookkeeping, not a hot path.
      for (let i = 0; i < eventSeqs.length; i++) {
        const seq = eventSeqs[i] as number;
        await db
          .update(auditLog)
          .set({ chunkSeq, chunkRowIndex: i })
          .where(and(eq(auditLog.bidSessionId, bidSessionId), eq(auditLog.seq, seq)));
      }
    },
  };
}
