import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { auditInsertStatement } from '../../lib/audit.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { loadPostAwardObligations } from '../../lib/post-award-obligations.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.get('/:session', async (c) => {
  const date = c.req.query('as_of');
  if (!date || !isIsoCalendarDate(date)) return c.json({ error: 'valid_as_of_required' }, 400);
  const result = await loadPostAwardObligations(c.env.DB, c.req.param('session'), date);
  return result.ok ? c.json(result) : c.json(result, 409);
});
const Body = z
  .object({
    final_bid_id: z.string().min(1),
    obligation_id: z.string().min(1),
    expected_revision: z.number().int().nonnegative(),
    expected_completion_seq: z.number().int().nonnegative(),
    effective_on: z.string().refine(isIsoCalendarDate),
    status: z.enum(['COMPLETED', 'PENDING', 'UNKNOWN']),
    completed_on: z.string().refine(isIsoCalendarDate).nullable(),
    source_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
  .strict()
  .refine(
    (b) =>
      b.status === 'COMPLETED'
        ? b.completed_on !== null && b.completed_on <= b.effective_on
        : b.completed_on === null,
    'Review the completion date',
  );
router.post('/:session/reviews', requireStepUpAuth(), async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  const session = c.req.param('session');
  const actor = String(c.get('claims').sub);
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const request = JSON.stringify({ session, body });
  const receipt = () =>
    c.env.DB.prepare(
      'SELECT id,revision,actor_subject,request_json FROM post_award_obligation_reviews WHERE idempotency_key=?',
    )
      .bind(key)
      .first<{ id: string; revision: number; actor_subject: string; request_json: string }>();
  const prior = await receipt();
  if (prior)
    return prior.actor_subject === actor && prior.request_json === request
      ? c.json({ id: prior.id, revision: prior.revision, replayed: true })
      : c.json({ error: 'idempotency_key_reused' }, 409);
  const projection = await loadPostAwardObligations(c.env.DB, session, body.effective_on);
  if (!projection.ok) return c.json(projection, 409);
  const obligation = projection.obligations.find(
    (o) => o.finalBidId === body.final_bid_id && o.term.id === body.obligation_id,
  );
  if (
    !obligation ||
    !obligation.award ||
    projection.completion.revision !== body.expected_completion_seq ||
    obligation.latestRevision !== body.expected_revision
  )
    return c.json({ error: 'official_award_obligation_or_revision_changed' }, 409);
  const id = ulid();
  const revision = body.expected_revision + 1;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO post_award_obligation_reviews (id,bid_session_id,final_bid_id,obligation_id,completion_seq,revision,effective_on,status,completed_on,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        session,
        body.final_bid_id,
        body.obligation_id,
        body.expected_completion_seq,
        revision,
        body.effective_on,
        body.status,
        body.completed_on,
        body.source_ref,
        actor,
        body.reason,
        key,
        request,
        Date.now(),
      ),
      auditInsertStatement(c.env.DB, {
        bidSessionId: session,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'qualification_lifecycle',
        targetKind: 'post_award_obligation_review',
        targetId: id,
        reason: body.reason,
        afterState: {
          ...body,
          revision,
          awardEventId: obligation.award.eventId,
          memberId: obligation.memberId,
          positionId: obligation.positionId,
        },
      }),
    ]);
  } catch {
    const concurrent = await receipt();
    if (concurrent?.actor_subject === actor && concurrent.request_json === request)
      return c.json({ id: concurrent.id, revision: concurrent.revision, replayed: true });
    return c.json({ error: 'obligation_revision_date_or_completion_changed' }, 409);
  }
  return c.json({ id, revision, replayed: false }, 201);
});
export default router;
