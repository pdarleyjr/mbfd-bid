// Plan 08 Task 24 — Admin endpoints for manual portal write-back operations.
//
//   POST /portal-retry/:bid_id        Reset a failed bid to pending so the
//                                     reconciliation cron picks it up.
//   GET  /portal-status/:session_id   List bids with pending/failed status.
//   POST /portal-clear-year           Mark all bids in a year as superseded
//                                     (e.g., when re-running a corrupted bid).
//                                     Requires dual confirmation phrase.

import type { JwtPayload } from '@mbfd/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { bidSessions, bids, portalWritebackQueue } from '../../db/schema.js';
import { auditInsertStatement } from '../../lib/audit.js';
import { chunkedInArrayMutate, chunkedInArraySelect } from '../../lib/d1-batch.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import { drainFinalOutbox, finalPublicationStatus } from '../../portal-writeback/final-outbox.js';
import { previewFinalPublication } from '../../portal-writeback/final-preview.js';
import {
  FinalPublicationBodySchema,
  publicationJson,
} from '../../portal-writeback/final-source.js';
import { isPortalPublicationEnabled } from '../../portal-writeback/publication-policy.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.post('/portal-retry/:bid_id', requireStepUpAuth(), async (c) => {
  const bidId = c.req.param('bid_id');
  if (!bidId) return c.json({ error: 'bid_id_required' }, 400);
  if (!isPortalPublicationEnabled(c.env)) {
    return c.json({ error: 'portal_writeback_disabled' }, 409);
  }
  const db = getDb(c.env.DB);
  const bid = await db.select().from(bids).where(eq(bids.id, bidId)).get();
  if (!bid) return c.json({ error: 'not_found' }, 404);
  if (bid.portalSyncStatus !== 'failed') {
    return c.json({ error: 'portal_retry_requires_failed_bid' }, 409);
  }
  // This auditable command receipt is persisted before the state transition.
  // Portal retry changes two tables, so the pre-state receipt prevents an
  // unaudited retry even if a later D1 write or queue reconciliation fails.
  await c.env.DB.batch([
    auditInsertStatement(c.env.DB, {
      bidSessionId: bid.bidSessionId,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'portal_writeback_retry',
      targetKind: 'portal_writeback_bid',
      targetId: bidId,
      beforeState: {
        portal_sync_status: bid.portalSyncStatus,
        portal_sync_attempts: bid.portalSyncAttempts,
      },
      afterState: { portal_sync_status: 'pending', portal_sync_attempts: 0 },
      reason: 'Authorized portal writeback retry requested.',
    }),
  ]);
  await db
    .update(bids)
    .set({ portalSyncStatus: 'pending', portalSyncAttempts: 0, portalLastError: null })
    .where(eq(bids.id, bidId));
  // Reset any orphan queue row to queued so the daily reconciliation re-emits it.
  await db
    .update(portalWritebackQueue)
    .set({ status: 'queued', attempts: 0, lastError: null })
    .where(eq(portalWritebackQueue.bidId, bidId));
  return c.json({ ok: true, bid_id: bidId });
});

router.get('/portal-status/:session_id', async (c) => {
  const sid = c.req.param('session_id');
  if (!sid) return c.json({ error: 'session_id_required' }, 400);
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(bids)
    .where(and(eq(bids.bidSessionId, sid), inArray(bids.portalSyncStatus, ['pending', 'failed'])))
    .all();
  return c.json({ bids: rows, final_publication: await finalPublicationStatus(c.env.DB, sid) });
});

for (const operation of ['preview', 'publish'] as const) {
  router.post(`/portal-final/:session_id/${operation}`, requireStepUpAuth(), async (c) => {
    const parsed = FinalPublicationBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid_final_source', issues: parsed.error.issues }, 400);
    const body = parsed.data;
    const sessionId = c.req.param('session_id');
    const preview = await previewFinalPublication(c.env.DB, sessionId, body);
    if (!preview.ok)
      return c.json({ error: 'final_reconciliation_required', issues: preview.issues }, 409);
    const status = await finalPublicationStatus(c.env.DB, sessionId);
    if (operation === 'preview')
      return c.json({
        session_id: sessionId,
        source_sequence: preview.sequence,
        source_result_hash: preview.resultHash,
        source_workbook_sha256: body.workbook_sha256,
        manifest_sha256: preview.manifestHash,
        hub_identity_receipt_sha256: body.hub_identity_receipt_sha256,
        confirmation_phrase: preview.confirmationPhrase,
        counts: preview.counts,
        metadata_overrides: preview.overrides,
        assignments: preview.payloads,
        publication: status,
        publication_enabled:
          isPortalPublicationEnabled(c.env) &&
          !!c.env.PORTAL_QUEUE &&
          typeof c.env.PORTAL_QUEUE.send === 'function',
        side_effects: 0,
      });
    if (!isPortalPublicationEnabled(c.env))
      return c.json({ error: 'portal_writeback_disabled' }, 409);
    if (!c.env.PORTAL_QUEUE || typeof c.env.PORTAL_QUEUE.send !== 'function')
      return c.json({ error: 'portal_queue_not_configured' }, 503);
    if (body.confirmation_phrase !== preview.confirmationPhrase)
      return c.json(
        { error: 'confirmation_phrase_mismatch', expected: preview.confirmationPhrase },
        400,
      );
    const nowMs = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO final_portal_publications
        (id,bid_session_id,source_sequence,source_result_hash,source_workbook_sha256,manifest_sha256,
          manifest_json,hub_identity_receipt_sha256,actor_member_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
        preview.publicationId,
        sessionId,
        preview.sequence,
        preview.resultHash,
        body.workbook_sha256,
        preview.manifestHash,
        preview.manifestJson,
        body.hub_identity_receipt_sha256,
        c.get('claims').member_id,
        nowMs,
      ),
      c.env.DB.prepare(`INSERT OR IGNORE INTO final_portal_outbox
        (id,publication_id,employee_id,position_id,assignment_source,payload_json,status,attempts,next_attempt_at)
        SELECT json_extract(value,'$.idempotency_key'),?,json_extract(value,'$.employee_id'),
          json_extract(value,'$.position_id'),json_extract(value,'$.assignment_source'),value,'queued',0,?
          FROM json_each(?)`).bind(preview.publicationId, nowMs, publicationJson(preview.payloads)),
      c.env.DB.prepare(`UPDATE final_portal_outbox SET status='superseded'
        WHERE publication_id IN (SELECT id FROM final_portal_publications
          WHERE bid_session_id=? AND source_sequence<?) AND status<>'superseded'`).bind(
        sessionId,
        preview.sequence,
      ),
      auditInsertStatement(c.env.DB, {
        bidSessionId: sessionId,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'result_distribution_review',
        targetKind: 'final_portal_publication',
        targetId: preview.publicationId,
        afterState: {
          source_sequence: preview.sequence,
          source_result_hash: preview.resultHash,
          source_workbook_sha256: body.workbook_sha256,
          manifest_sha256: preview.manifestHash,
          hub_identity_receipt_sha256: body.hub_identity_receipt_sha256,
          counts: preview.counts,
          metadata_overrides: preview.overrides,
        },
        reason:
          'Confirmed final workbook reconciliation and durable employee assignment publication.',
      }),
    ]);
    const sent = await drainFinalOutbox(c.env, sessionId);
    return c.json({
      ok: true,
      publication_id: preview.publicationId,
      queue_messages_sent: sent,
      ...(await finalPublicationStatus(c.env.DB, sessionId)),
    });
  });
}

router.post('/portal-final-retry/:outbox_id', requireStepUpAuth(), async (c) => {
  if (!isPortalPublicationEnabled(c.env))
    return c.json({ error: 'portal_writeback_disabled' }, 409);
  const id = c.req.param('outbox_id');
  const row =
    await c.env.DB.prepare(`SELECT o.status,p.bid_session_id,p.source_sequence,c.current_seq
    FROM final_portal_outbox o JOIN final_portal_publications p ON p.id=o.publication_id
    JOIN canonical_bid_session_state c ON c.bid_session_id=p.bid_session_id WHERE o.id=?`)
      .bind(id)
      .first<{
        status: string;
        bid_session_id: string;
        source_sequence: number;
        current_seq: number;
      }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'failed' || row.current_seq !== row.source_sequence)
    return c.json({ error: 'current_failed_publication_required' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE final_portal_outbox SET status='queued',attempts=0,last_error=NULL,next_attempt_at=?
      WHERE id=? AND status='failed'`).bind(Date.now(), id),
    auditInsertStatement(c.env.DB, {
      bidSessionId: row.bid_session_id,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'portal_writeback_retry',
      targetKind: 'final_portal_outbox',
      targetId: id,
      reason: 'Authorized retry of a current final assignment publication.',
    }),
  ]);
  return c.json({
    ok: true,
    queue_messages_sent: await drainFinalOutbox(c.env, row.bid_session_id),
  });
});

const ClearYearBody = z.object({
  year: z.number().int().min(2024).max(2099),
  confirmation_phrase: z.string(),
});

router.post('/portal-clear-year', requireStepUpAuth(), async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = ClearYearBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const expectedPhrase = `CLEAR YEAR ${body.year}`;
  if (body.confirmation_phrase !== expectedPhrase) {
    return c.json({ error: 'confirmation_phrase_mismatch', expected: expectedPhrase }, 400);
  }
  const db = getDb(c.env.DB);
  const sessions = await db
    .select({ id: bidSessions.id })
    .from(bidSessions)
    .where(eq(bidSessions.bidYear, body.year))
    .all();
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return c.json({ cleared: 0 });

  // Chunk every IN-list — a year's bids can easily exceed D1's per-statement
  // placeholder cap when there are 200+ positions across N sessions.
  const affected = await chunkedInArraySelect(sessionIds, (chunk) =>
    db.select({ id: bids.id }).from(bids).where(inArray(bids.bidSessionId, chunk)).all(),
  );
  const affectedIds = affected.map((a) => a.id);

  // Clear-year potentially spans multiple D1 batches because D1 caps bound
  // parameters. Persist the authoritative command receipt before the first
  // mutation, so no successful portal-control mutation can lose its audit.
  await c.env.DB.batch([
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'portal_writeback_clear',
      targetKind: 'portal_writeback_year',
      targetId: String(body.year),
      beforeState: { affected_bid_count: affectedIds.length },
      afterState: { portal_sync_status: 'superseded', queue_rows_removed: true },
      reason: `Authorized portal writeback clear for year ${body.year}.`,
    }),
  ]);

  await chunkedInArrayMutate(sessionIds, (chunk) =>
    db
      .update(bids)
      .set({ portalSyncStatus: 'superseded' })
      .where(inArray(bids.bidSessionId, chunk)),
  );

  if (affectedIds.length > 0) {
    await chunkedInArrayMutate(affectedIds, (chunk) =>
      db.delete(portalWritebackQueue).where(inArray(portalWritebackQueue.bidId, chunk)),
    );
  }
  return c.json({ cleared: affectedIds.length });
});

export default router;
