import { and, eq, lte } from 'drizzle-orm';
import { AnthropicAIClient } from './ai/client.js';
import { systemBlock } from './ai/prompts/system-2026.js';
import { rosterBlock } from './ai/prompts/user-roster.js';
import { turnBlock } from './ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from './ai/session-loader.js';
import { getDb } from './db/index.js';
import { bidSessions, bids, portalWritebackQueue } from './db/schema.js';
import type { QueueMessage } from './portal-writeback/queue-producer.js';
import { type DueQueueRow, runReconciliation } from './portal-writeback/reconciliation.js';
import type { WorkerEnv } from './types/env.js';

const FORECAST_QUESTION =
  'Provide a department-wide forecast: which credentials are running short, ' +
  'which positions look likely to go unfilled, which members are most affected. ' +
  'Return ONLY the JSON object specified in the system prompt.';

/**
 * Plan 08 Task 25 — daily portal-writeback reconciliation.
 * Re-enqueues queue rows whose `next_attempt_at` is in the past and the
 * status is still `queued`. Also counts failed bids for the admin banner.
 * Called from the `scheduled` handler when event.cron matches the 04:15 UTC
 * pattern. Safe to invoke even without the PORTAL_QUEUE binding (no-op).
 */
export async function handlePortalReconciliation(env: WorkerEnv): Promise<void> {
  if (!env.PORTAL_QUEUE || typeof env.PORTAL_QUEUE.send !== 'function') return;
  const db = getDb(env.DB);
  const queue = env.PORTAL_QUEUE;
  const nowMs = Date.now();
  const result = await runReconciliation({
    nowMs,
    async listDueQueueRows(): Promise<DueQueueRow[]> {
      const rows = await db
        .select()
        .from(portalWritebackQueue)
        .where(
          and(
            eq(portalWritebackQueue.status, 'queued'),
            lte(portalWritebackQueue.nextAttemptAt, new Date(nowMs)),
          ),
        )
        .all();
      return rows.map((r) => ({
        id: r.id,
        payloadJson: r.payloadJson,
        attempts: r.attempts,
        bidId: r.bidId,
      }));
    },
    async listFailedBids() {
      const rows = await db
        .select({ id: bids.id })
        .from(bids)
        .where(eq(bids.portalSyncStatus, 'failed'))
        .all();
      return rows;
    },
    async reEnqueue(row) {
      // Best-effort: deserialize the persisted payload and look up the member
      // employee ID lazily. If anything is missing we skip — the next run
      // will retry with the (possibly fixed) state.
      const parsedPayload = JSON.parse(row.payloadJson);
      const bidRow = await db.select().from(bids).where(eq(bids.id, row.bidId)).get();
      if (!bidRow) return;
      const message: QueueMessage = {
        bidId: row.bidId,
        employeeId: parsedPayload.idempotency_key
          ? (String(parsedPayload.idempotency_key).split('_').pop() ?? '')
          : '',
        payload: parsedPayload,
        attempts: row.attempts,
        queueRowId: row.id,
      };
      await queue.send(message);
    },
  });
  console.info('[portal-reconciliation]', result);
}

export async function handleScheduled(env: WorkerEnv): Promise<void> {
  const db = getDb(env.DB);
  const live = await db
    .select({ id: bidSessions.id })
    .from(bidSessions)
    .where(eq(bidSessions.currentPhase, 'position_bid'))
    .all();
  if (live.length === 0) return;

  const client = new AnthropicAIClient(env);
  for (const s of live) {
    const roster = await loadRosterForSession(env, s.id);
    const state = await loadTurnStateForSession(env, s.id);
    try {
      const envelope = await client.adviseCurrent({
        bidSessionId: s.id,
        system: systemBlock(),
        roster: rosterBlock(roster),
        turn: turnBlock({ ...state, question: FORECAST_QUESTION }),
      });
      await env.AI_KV.put(`ai_forecast:${s.id}`, JSON.stringify(envelope), {
        expirationTtl: 60 * 60,
      });
    } catch {
      // best-effort; consumers see the old cached value or 404
    }
  }
}
