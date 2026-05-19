// Plan 08 Task 7 — In-memory chunker for one session's audit events.
//
// Flush triggers:
//   - threshold: buffer reaches FLUSH_THRESHOLD_EVENTS (100)
//   - timeout:   buffer is older than FLUSH_TIMEOUT_MS (30s)
//   - drain:     explicit drain() call (e.g. session_end)
//
// The chunker is per-session and held in a Map keyed by bid_session_id.
// It is process-local memory — durability is provided by the post-flush
// write to R2; if the worker is evicted before a flush, the events still
// live in the D1 audit_log row and will be re-emitted on session resume.

import type { AuditEvent } from '@mbfd/shared';

import {
  type ChunkFlush,
  FLUSH_THRESHOLD_EVENTS,
  FLUSH_TIMEOUT_MS,
  type FlushReason,
} from './types.js';

export { FLUSH_THRESHOLD_EVENTS, FLUSH_TIMEOUT_MS };

export class JsonlChunker {
  private buffer: AuditEvent[] = [];
  private startedAt: number | null = null;

  /** Add an event. Returns a `ChunkFlush` if the threshold trips, else `null`. */
  add(event: AuditEvent, nowMs: number): ChunkFlush | null {
    if (this.startedAt === null) this.startedAt = nowMs;
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_THRESHOLD_EVENTS) {
      return this.flush('threshold', nowMs);
    }
    return null;
  }

  /** Returns a `ChunkFlush` if the buffer is older than 30s, else `null`. */
  flushIfStale(nowMs: number): ChunkFlush | null {
    if (this.buffer.length === 0 || this.startedAt === null) return null;
    if (nowMs - this.startedAt >= FLUSH_TIMEOUT_MS) {
      return this.flush('timeout', nowMs);
    }
    return null;
  }

  /** Force-flush whatever is buffered. Returns `null` if buffer is empty. */
  drain(reason: 'drain' | 'session_end' = 'drain'): ChunkFlush | null {
    if (this.buffer.length === 0) return null;
    return this.flush(reason, Date.now());
  }

  /** True if any events are buffered. */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /** Diagnostic — current buffer size. */
  size(): number {
    return this.buffer.length;
  }

  private flush(reason: FlushReason, nowMs: number): ChunkFlush {
    const out: ChunkFlush = {
      events: this.buffer,
      reason,
      bufferStartedAt: this.startedAt ?? nowMs,
      bufferEndedAt: nowMs,
    };
    this.buffer = [];
    this.startedAt = null;
    return out;
  }
}
