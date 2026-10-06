import type { PortalPayloadV2 } from '@mbfd/shared';
import { PortalPayloadV2Schema } from '@mbfd/shared';
import { auditInsertStatement } from '../lib/audit.js';
import type { WorkerEnv } from '../types/env.js';
import { publicationJson } from './final-source.js';
import { isPortalPublicationEnabled } from './publication-policy.js';
import type { ConsumerDeps } from './queue-consumer.js';
import type { QueueMessage } from './queue-producer.js';

type OutboxRow = {
  id: string;
  publication_id: string;
  employee_id: string;
  payload_json: string;
  status: string;
  attempts: number;
  next_attempt_at: number;
  bid_session_id: string;
  source_sequence: number;
  current_seq: number;
  is_mock: number;
  state_json: string;
};

async function loadOutbox(db: D1Database, id: string) {
  return db
    .prepare(`SELECT o.*,p.bid_session_id,p.source_sequence,c.current_seq,s.is_mock,c.state_json
    FROM final_portal_outbox o JOIN final_portal_publications p ON p.id=o.publication_id
    JOIN bid_sessions s ON s.id=p.bid_session_id
    JOIN canonical_bid_session_state c ON c.bid_session_id=p.bid_session_id WHERE o.id=?`)
    .bind(id)
    .first<OutboxRow>();
}

/** Reuse delivery/retry state machine without touching competitive Bid records. */
export function finalConsumerDeps(env: WorkerEnv, base: ConsumerDeps): ConsumerDeps {
  return {
    ...base,
    async recordAudit(entry) {
      await base.recordAudit({ ...entry, targetKind: 'final_portal_outbox' });
    },
    async markBidSynced(id, at, attempts) {
      await env.DB.prepare(
        'UPDATE final_portal_outbox SET synced_at=?,attempts=?,last_error=NULL WHERE id=?',
      )
        .bind(at.getTime(), attempts, id)
        .run();
    },
    async markBidFailed(id, error, attempts) {
      await env.DB.prepare('UPDATE final_portal_outbox SET attempts=?,last_error=? WHERE id=?')
        .bind(attempts, error, id)
        .run();
    },
    async incrementAttempts(id, attempts) {
      await env.DB.prepare('UPDATE final_portal_outbox SET attempts=? WHERE id=?')
        .bind(attempts, id)
        .run();
    },
    async updateQueueRow(row) {
      await env.DB.prepare(`UPDATE final_portal_outbox SET status=?,attempts=?,last_error=?,
        next_attempt_at=COALESCE(?,next_attempt_at) WHERE id=? AND status<>'superseded'`)
        .bind(row.status, row.attempts, row.lastError, row.nextAttemptAt?.getTime() ?? null, row.id)
        .run();
    },
  };
}

export async function claimFinalMessage(
  env: WorkerEnv,
  msg: QueueMessage,
  nowMs: number,
): Promise<'claimed' | 'skip' | 'retry'> {
  const row = await loadOutbox(env.DB, msg.queueRowId);
  if (!row) return 'skip';
  if (
    row.is_mock !== 0 ||
    row.current_seq !== row.source_sequence ||
    JSON.parse(row.state_json).currentPhase !== 'complete'
  ) {
    if (row.status !== 'superseded')
      await env.DB.batch([
        env.DB.prepare("UPDATE final_portal_outbox SET status='superseded' WHERE id=?").bind(
          row.id,
        ),
        auditInsertStatement(env.DB, {
          bidSessionId: row.bid_session_id,
          actorType: 'system',
          actorId: null,
          action: 'portal_writeback_outcome',
          targetKind: 'final_portal_outbox',
          targetId: row.id,
          afterState: {
            status: 'superseded',
            source_sequence: row.source_sequence,
            current_sequence: row.current_seq,
          },
          reason: 'Canonical result changed before final assignment delivery.',
        }),
      ]);
    return 'skip';
  }
  if (row.status === 'done' || row.status === 'failed' || row.status === 'superseded')
    return 'skip';
  if (
    msg.finalPublicationId !== row.publication_id ||
    msg.bidId !== row.id ||
    msg.employeeId !== row.employee_id ||
    publicationJson(msg.payload) !== publicationJson(JSON.parse(row.payload_json))
  )
    return 'retry';
  if (msg.attempts !== row.attempts) return 'skip';
  const result =
    await env.DB.prepare(`UPDATE final_portal_outbox SET status='in_flight',next_attempt_at=?
    WHERE id=? AND attempts=? AND
      (status='queued' OR (status='in_flight' AND next_attempt_at<=?))
      AND EXISTS (SELECT 1 FROM final_portal_publications p JOIN canonical_bid_session_state c
        ON c.bid_session_id=p.bid_session_id WHERE p.id=publication_id AND p.source_sequence=c.current_seq)`)
      .bind(nowMs + 300_000, row.id, msg.attempts, nowMs)
      .run();
  return result.meta.changes === 1 ? 'claimed' : 'skip';
}

export async function drainFinalOutbox(env: WorkerEnv, sessionId?: string) {
  if (!isPortalPublicationEnabled(env)) return 0;
  if (!env.PORTAL_QUEUE || typeof env.PORTAL_QUEUE.send !== 'function') return 0;
  const nowMs = Date.now();
  const due = await env.DB.prepare(`SELECT o.id FROM final_portal_outbox o
    JOIN final_portal_publications p ON p.id=o.publication_id
    WHERE o.status IN ('queued','in_flight') AND o.next_attempt_at<=?
      ${sessionId ? 'AND p.bid_session_id=?' : ''} ORDER BY o.id LIMIT 226`)
    .bind(...(sessionId ? [nowMs, sessionId] : [nowMs]))
    .all<{ id: string }>();
  let sent = 0;
  for (const entry of due.results) {
    const row = await loadOutbox(env.DB, entry.id);
    if (!row) continue;
    const payload = PortalPayloadV2Schema.parse(JSON.parse(row.payload_json));
    const msg: QueueMessage = {
      bidId: row.id,
      queueRowId: row.id,
      employeeId: row.employee_id,
      payload,
      attempts: row.attempts,
      finalPublicationId: row.publication_id,
    };
    // Claim in the consumer. Persisted outbox survives every failed Queue.send.
    try {
      await env.PORTAL_QUEUE.send(msg);
      sent++;
    } catch {
      /* cron retries the durable row */
    }
  }
  return sent;
}

export async function finalPublicationStatus(db: D1Database, sessionId: string) {
  const rows = await db
    .prepare(`SELECT CASE WHEN p.source_sequence<>c.current_seq THEN 'superseded' ELSE o.status END AS status,
      COUNT(*) AS count FROM final_portal_outbox o
    JOIN final_portal_publications p ON p.id=o.publication_id
    JOIN canonical_bid_session_state c ON c.bid_session_id=p.bid_session_id WHERE p.bid_session_id=?
    GROUP BY CASE WHEN p.source_sequence<>c.current_seq THEN 'superseded' ELSE o.status END`)
    .bind(sessionId)
    .all<{ status: string; count: number }>();
  const counts: Record<string, number> = {
    queued: 0,
    in_flight: 0,
    done: 0,
    failed: 0,
    superseded: 0,
  };
  for (const row of rows.results) counts[row.status] = row.count;
  const latest = await db
    .prepare(`SELECT id,source_sequence,source_result_hash,source_workbook_sha256,manifest_sha256,
    hub_identity_receipt_sha256,created_at FROM final_portal_publications
    WHERE bid_session_id=? ORDER BY source_sequence DESC LIMIT 1`)
    .bind(sessionId)
    .first();
  return { counts, latest };
}

export type FinalOutboxPayload = PortalPayloadV2;
