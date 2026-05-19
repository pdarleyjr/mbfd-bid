// Plan 08 — shared audit-pipeline types.
//
// Lives next to canonical-json/hash-chain/signer so the chunker stays a
// pure in-memory data structure. The constants are exported as module-level
// values so tests can assert exact thresholds without importing internals.

import type { AuditEvent } from '@mbfd/shared';

/** Hard upper bound of events buffered before a synchronous flush. */
export const FLUSH_THRESHOLD_EVENTS = 100;

/** Maximum age of the oldest buffered event before the cron force-flushes. */
export const FLUSH_TIMEOUT_MS = 30_000;

export type FlushReason = 'threshold' | 'timeout' | 'drain' | 'session_end';

export interface ChunkFlush {
  events: AuditEvent[];
  reason: FlushReason;
  bufferStartedAt: number;
  bufferEndedAt: number;
}
