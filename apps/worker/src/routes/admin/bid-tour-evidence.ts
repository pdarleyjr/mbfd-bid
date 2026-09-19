import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { auditInsertStatement } from '../../lib/audit.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
const Body = z
  .object({
    memberId: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
    effectiveOn: z.string().refine(isIsoCalendarDate),
    completedDaysTour: z.boolean().nullable(),
    sourceRef: z.string().trim().min(4).max(1000),
    reason: z.string().trim().min(4).max(1000),
  })
  .strict();
router.get('/:memberId', async (c) => {
  const id = Number(c.req.param('memberId'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'invalid_member' }, 400);
  c.header('Cache-Control', 'private, no-store');
  const rows = await c.env.DB.prepare(
    'SELECT id,revision,effective_on AS effectiveOn,completed_days_tour AS completedDaysTour,source_ref AS sourceRef FROM member_bid_tour_evidence WHERE member_id=? ORDER BY revision DESC',
  )
    .bind(id)
    .all();
  return c.json({ records: rows.results });
});
router.post('/', requireStepUpAuth(), async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_tour_evidence' }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify(body);
  const receipt = () =>
    c.env.DB.prepare(
      'SELECT id,revision,actor_subject,request_json FROM member_bid_tour_evidence WHERE idempotency_key=?',
    )
      .bind(key)
      .first<{ id: string; revision: number; actor_subject: string; request_json: string }>();
  const previous = await receipt();
  if (previous)
    return previous.actor_subject === actor && previous.request_json === request
      ? c.json({ id: previous.id, revision: previous.revision, replayed: true })
      : c.json({ error: 'idempotency_key_reused' }, 409);
  const id = ulid();
  const revision = body.expectedRevision + 1;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO member_bid_tour_evidence (id,member_id,revision,effective_on,completed_days_tour,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        body.memberId,
        revision,
        body.effectiveOn,
        body.completedDaysTour === null ? null : Number(body.completedDaysTour),
        body.sourceRef,
        actor,
        body.reason,
        key,
        request,
        Date.now(),
      ),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'qualification_lifecycle',
        targetKind: 'member_bid_tour_evidence',
        targetId: id,
        reason: body.reason,
        afterState: { ...body, revision },
      }),
    ]);
  } catch {
    const concurrent = await receipt();
    if (concurrent?.actor_subject === actor && concurrent.request_json === request)
      return c.json({ id: concurrent.id, revision: concurrent.revision, replayed: true });
    return c.json({ error: 'bid_tour_member_or_revision_conflict' }, 409);
  }
  return c.json({ id, revision, replayed: false }, 201);
});
export default router;
