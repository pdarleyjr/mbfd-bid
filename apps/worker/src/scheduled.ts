import { and, eq, lte } from 'drizzle-orm';
import { WorkersAIClient } from './ai/client.js';
import { systemPrompt } from './ai/prompts/system-2026.js';
import { rosterPrompt } from './ai/prompts/user-roster.js';
import { turnPrompt, userPrompt } from './ai/prompts/user-turn.js';
import { loadRosterForSession, loadTurnStateForSession } from './ai/session-loader.js';
import { getDb } from './db/index.js';
import { bidSessions, bids, members, portalWritebackQueue } from './db/schema.js';
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
      // W38 — Look up the employeeId via the bids → members FK rather than
      // parsing it out of the idempotency_key. The earlier approach split
      // `idempotency_key` on `_` and took the trailing segment, which is
      // fragile for any key shape that doesn't end in the employeeId
      // (admin force-pick / rehearsal auto-bid keys do not).
      const parsedPayload = JSON.parse(row.payloadJson);
      const bidRow = await db.select().from(bids).where(eq(bids.id, row.bidId)).get();
      if (!bidRow) return;
      const memberRow = await db
        .select({ employeeId: members.employeeId })
        .from(members)
        .where(eq(members.id, bidRow.memberId))
        .get();
      if (!memberRow) return;
      const message: QueueMessage = {
        bidId: row.bidId,
        employeeId: memberRow.employeeId,
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

  const client = new WorkersAIClient(env);
  for (const s of live) {
    const roster = await loadRosterForSession(env, s.id);
    const state = await loadTurnStateForSession(env, s.id);
    try {
      const envelope = await client.adviseCurrent({
        bidSessionId: s.id,
        system: systemPrompt(),
        user: userPrompt({
          roster: rosterPrompt(roster),
          turn: turnPrompt({ ...state, question: FORECAST_QUESTION }),
        }),
      });
      await env.AI_KV.put(`ai_forecast:${s.id}`, JSON.stringify(envelope), {
        expirationTtl: 60 * 60,
      });
    } catch {
      // best-effort; consumers see the old cached value or 404
    }
  }
}
