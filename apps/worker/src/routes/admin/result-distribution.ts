import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  configurationReceiptStatement,
  loadConfigurationReceipt,
} from '../../lib/admin-configuration-receipt.js';
import { auditInsertStatement } from '../../lib/audit.js';
import { bidResultPackageCsv, loadBidResultPackage } from '../../lib/bid-result-package.js';
import { loadRehearsalAnnualCompletion } from '../../lib/official-annual-completion.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { evaluateFinalization } from '../../lib/post-bid-transition.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin, requireLiveBidAction } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
const channels = ['EMAIL', 'TARGETSOLUTIONS'] as const;
type Review = {
  id: string;
  channel: (typeof channels)[number];
  revision: number;
  status: 'COMPLETED' | 'REQUIRES_FOLLOW_UP';
  published_on: string | null;
  evidence_ref: string;
  reason: string;
  actor_subject: string;
  created_at: number;
};
const bodySchema = z
  .object({
    expectedCompletionSeq: z.number().int().nonnegative(),
    packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    channel: z.enum(channels),
    expectedRevision: z.number().int().nonnegative(),
    status: z.enum(['COMPLETED', 'REQUIRES_FOLLOW_UP']),
    publishedOn: z.string().refine(isIsoCalendarDate).nullable(),
    evidenceRef: z.string().trim().min(4).max(1000),
    reason: z.string().trim().min(4).max(1000),
  })
  .strict()
  .refine((body) =>
    body.status === 'COMPLETED' ? body.publishedOn !== null : body.publishedOn === null,
  );

router.get('/:id/rehearsal-transition-preview', async (c) => {
  const loaded = await loadRehearsalAnnualCompletion(c.env.DB, c.req.param('id'));
  if (!loaded.ok)
    return c.json({ error: loaded.error }, loaded.error === 'session_not_found' ? 404 : 409);
  const { completion } = loaded;
  const finalization = evaluateFinalization({
    annualCompletionAtMs: completion.completion.completedAtMs,
    expectedPositionIds: loaded.coverage.validRulePositionIds,
    awards: completion.participants,
    unresolvedMemberIds: completion.unresolvedMemberIds,
    topologyReference: completion.frozen.topologyReference,
    ruleBookVersion: completion.frozen.ruleBookVersion,
  });
  return c.json({
    sessionId: completion.sessionId,
    mode: 'MOCK',
    canApply: false,
    status: 'REHEARSAL_PROJECTION_ONLY',
    completion: completion.completion,
    projectedAssignments: completion.futureRoster,
    finalization: {
      complete: finalization.ok,
      blockers: finalization.ok ? [] : finalization.blockingCodes,
    },
    applicationBlockers: ['mock_session_not_transitionable'],
  });
});

router.get('/:id', async (c) => {
  const value = await loadBidResultPackage(c.env.DB, c.req.param('id'));
  if (!value.ok)
    return c.json({ error: value.error }, value.error === 'session_not_found' ? 404 : 409);
  const reviews = (
    await c.env.DB.prepare(
      'SELECT id,channel,revision,status,published_on,evidence_ref,reason,actor_subject,created_at FROM bid_result_distribution_reviews WHERE bid_session_id=? AND completion_seq=? AND package_sha256=? ORDER BY channel,revision DESC',
    )
      .bind(c.req.param('id'), value.document.completion.revision, value.packageSha256)
      .all<Review>()
  ).results;
  const channelStates = channels.map((channel) => ({
    channel,
    review: reviews.find((item) => item.channel === channel) ?? null,
  }));
  return c.json({
    sessionId: c.req.param('id'),
    completion: value.document.completion,
    packageSha256: value.packageSha256,
    status: channelStates.every((item) => item.review?.status === 'COMPLETED')
      ? 'EXTERNAL_EVIDENCE_RECORDED'
      : 'EXTERNAL_PUBLICATION_REQUIRED',
    channels: channelStates,
    externalDeliveryPerformed: false,
  });
});

router.get('/:id/package/:format', async (c) => {
  const format = c.req.param('format');
  if (format !== 'json' && format !== 'csv') return c.json({ error: 'invalid_format' }, 400);
  const value = await loadBidResultPackage(c.env.DB, c.req.param('id'));
  if (!value.ok)
    return c.json({ error: value.error }, value.error === 'session_not_found' ? 404 : 409);
  // Use only the verified numeric year and package digest in the attachment name.
  const expectedHash = c.req.query('sha256');
  if (expectedHash && expectedHash !== value.packageSha256)
    return c.json({ error: 'final_result_package_changed' }, 409);
  c.header(
    'Content-Disposition',
    `attachment; filename="mbfd-final-results-${value.document.bidYear}-${value.packageSha256.slice(0, 12)}.${format}"`,
  );
  c.header(
    'Content-Type',
    format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
  );
  return c.body(
    format === 'json'
      ? JSON.stringify({ packageSha256: value.packageSha256, ...value.document }, null, 2)
      : bidResultPackageCsv(value),
  );
});

router.post('/:id/reviews', requireStepUpAuth(), requireLiveBidAction('publish'), async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!key || key.trim() !== key || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const sessionId = c.req.param('id');
  const input = {
    key,
    actorSubject: String(c.get('claims').sub),
    operation: `bid-result-distribution.review:${sessionId}`,
    request: body,
  };
  const replay = await loadConfigurationReceipt(c.env.DB, input);
  if (replay)
    return replay.ok
      ? c.json({ ...replay.response, replayed: true })
      : c.json({ error: replay.error }, 409);
  const value = await loadBidResultPackage(c.env.DB, sessionId);
  if (!value.ok) return c.json({ error: value.error }, 409);
  if (
    value.document.completion.revision !== body.expectedCompletionSeq ||
    value.packageSha256 !== body.packageSha256
  )
    return c.json({ error: 'final_result_package_changed' }, 409);
  if (
    body.publishedOn &&
    (body.publishedOn > new Date().toISOString().slice(0, 10) ||
      body.publishedOn <
        new Date(value.document.completion.completedAtMs).toISOString().slice(0, 10))
  )
    return c.json({ error: 'publication_date_outside_completed_bid_window' }, 400);
  const id = ulid();
  const response = {
    id,
    revision: body.expectedRevision + 1,
    status: body.status,
    replayed: false,
  };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO bid_result_distribution_reviews
        (id,bid_session_id,completion_seq,completion_command_id,package_sha256,channel,revision,status,published_on,evidence_ref,reason,actor_subject,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM canonical_bid_session_state state JOIN bid_sessions session ON session.id=state.bid_session_id
          WHERE state.bid_session_id=? AND state.current_seq=? AND state.last_command_id=? AND session.is_mock=0
        ) AND COALESCE((SELECT MAX(revision) FROM bid_result_distribution_reviews WHERE bid_session_id=? AND completion_seq=? AND channel=?),0)=?`).bind(
        id,
        sessionId,
        body.expectedCompletionSeq,
        value.document.completion.commandId,
        body.packageSha256,
        body.channel,
        response.revision,
        body.status,
        body.publishedOn,
        body.evidenceRef,
        body.reason,
        input.actorSubject,
        Date.now(),
        sessionId,
        body.expectedCompletionSeq,
        value.document.completion.commandId,
        sessionId,
        body.expectedCompletionSeq,
        body.channel,
        body.expectedRevision,
      ),
      auditInsertStatement(
        c.env.DB,
        {
          bidSessionId: sessionId,
          actorType: 'admin',
          actorId: c.get('claims').member_id,
          action: 'result_distribution_review',
          targetKind: 'result_distribution_evidence',
          targetId: id,
          afterState: { ...body, revision: response.revision, externalDeliveryPerformed: false },
          reason: body.reason,
        },
        new Date(),
        true,
      ),
      configurationReceiptStatement(c.env.DB, input, response),
    ]);
  } catch {
    const concurrent = await loadConfigurationReceipt(c.env.DB, input);
    if (concurrent?.ok) return c.json({ ...concurrent.response, replayed: true });
    return c.json(
      { error: concurrent ? 'idempotency_key_reused' : 'distribution_review_revision_changed' },
      409,
    );
  }
  return c.json(response, 201);
});
export default router;
