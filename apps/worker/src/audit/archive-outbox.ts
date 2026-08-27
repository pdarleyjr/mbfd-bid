import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

interface DueOutboxRow {
  id: string;
  archive_key: string;
  payload_json: string;
  payload_sha256: string;
  attempts: number;
}

export interface DrainBidAuditOutboxInput {
  db: D1Database;
  r2: Pick<R2Bucket, 'put'>;
  nowMs?: () => number;
  /** Stable per-invocation identity used to guard an optimistic D1 lease. */
  leaseOwner?: string;
  leaseMs?: number;
  retryDelayMs?: (attempt: number) => number;
  limit?: number;
}

export interface DrainBidAuditOutboxResult {
  scanned: number;
  archived: number;
  retried: number;
  deadLettered: number;
  /** R2 writes that failed before D1 retry state could be acknowledged. */
  r2PutFailures: number;
  /** Conditional D1 state transitions that did not persist. */
  acknowledgementFailures: number;
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

function changes(result: unknown): number {
  if (
    typeof result === 'object' &&
    result !== null &&
    typeof (result as { meta?: { changes?: unknown } }).meta?.changes === 'number'
  ) {
    return (result as { meta: { changes: number } }).meta.changes;
  }
  return 0;
}

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 1_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 12));
}

/**
 * Archives committed canonical command events to R2 after their D1 commit.
 *
 * This method is intentionally post-commit: it never throws an R2 delivery
 * failure back into the command path. It uses an optimistic D1 lease so a
 * cron repair and a post-command background attempt cannot archive the same
 * payload concurrently. A hash mismatch is fail-closed into `dead_letter`;
 * a transient R2 failure becomes retryable work.
 */
export async function drainBidAuditOutbox(
  input: DrainBidAuditOutboxInput,
): Promise<DrainBidAuditOutboxResult> {
  const now = (input.nowMs ?? Date.now)();
  const leaseOwner = input.leaseOwner ?? crypto.randomUUID();
  const leaseExpiresAt = now + (input.leaseMs ?? 60_000);
  const retryDelayMs = input.retryDelayMs ?? defaultRetryDelayMs;
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const due = await input.db
    .prepare(
      `SELECT id, archive_key, payload_json, payload_sha256, attempts
         FROM bid_audit_outbox
        WHERE (status IN ('pending', 'retry') AND next_attempt_at <= ?)
           OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
        ORDER BY next_attempt_at, created_at
        LIMIT ?`,
    )
    .bind(now, now, limit)
    .all<DueOutboxRow>();
  const rows = due.results ?? [];
  const result: DrainBidAuditOutboxResult = {
    scanned: rows.length,
    archived: 0,
    retried: 0,
    deadLettered: 0,
    r2PutFailures: 0,
    acknowledgementFailures: 0,
  };

  for (const row of rows) {
    const lease = await input.db
      .prepare(
        `UPDATE bid_audit_outbox
            SET status = 'leased', attempts = attempts + 1, lease_owner = ?, lease_expires_at = ?, updated_at = ?
          WHERE id = ?
            AND (
              (status IN ('pending', 'retry') AND next_attempt_at <= ?)
              OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
            )`,
      )
      .bind(leaseOwner, leaseExpiresAt, now, row.id, now, now)
      .run();
    if (changes(lease) !== 1) continue;

    if (sha256Hex(row.payload_json) !== row.payload_sha256) {
      try {
        const deadLetter = await input.db
          .prepare(
            `UPDATE bid_audit_outbox
                SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
                    last_error = 'PAYLOAD_SHA256_MISMATCH', updated_at = ?
              WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
          )
          .bind(now, row.id, leaseOwner)
          .run();
        if (changes(deadLetter) === 1) {
          result.deadLettered++;
        } else {
          result.acknowledgementFailures++;
        }
      } catch {
        result.acknowledgementFailures++;
      }
      continue;
    }

    try {
      await input.r2.put(row.archive_key, row.payload_json, {
        httpMetadata: { contentType: 'application/json' },
      });
    } catch {
      result.r2PutFailures++;
      const nextAttemptAt = now + retryDelayMs(row.attempts + 1);
      try {
        const retry = await input.db
          .prepare(
            `UPDATE bid_audit_outbox
                SET status = 'retry', next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
                    last_error = 'R2_ARCHIVE_FAILED', updated_at = ?
              WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
          )
          .bind(nextAttemptAt, now, row.id, leaseOwner)
          .run();
        if (changes(retry) === 1) {
          result.retried++;
        } else {
          result.acknowledgementFailures++;
        }
      } catch {
        result.acknowledgementFailures++;
      }
      continue;
    }

    try {
      const archived = await input.db
        .prepare(
          `UPDATE bid_audit_outbox
              SET status = 'archived', next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
                  archived_at = ?, last_error = NULL, updated_at = ?
            WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
        )
        .bind(now, now, now, row.id, leaseOwner)
        .run();
      if (changes(archived) === 1) {
        result.archived++;
      } else {
        result.acknowledgementFailures++;
      }
    } catch {
      // The immutable R2 key was written successfully, but its D1
      // acknowledgement was not. Leave the lease in place for expiry/replay;
      // do not misclassify this as an R2 failure.
      result.acknowledgementFailures++;
    }
  }

  return result;
}
