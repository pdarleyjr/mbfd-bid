import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { auditInsertStatement } from '../../lib/audit.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { loadTenureAsOf } from '../../lib/tenure-evidence.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
const BodySchema = z
  .object({
    staffing_position_id: z.string().min(1),
    expected_revision: z.number().int().nonnegative(),
    effective_on: z.string().refine(isIsoCalendarDate),
    status: z.enum(['PROTECTED', 'UNPROTECTED', 'UNKNOWN']),
    member_id: z.number().int().positive().nullable(),
    protected_from: z.string().refine(isIsoCalendarDate).nullable(),
    protected_through: z.string().refine(isIsoCalendarDate).nullable(),
    source_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
  .strict()
  .refine(
    (b) =>
      b.status === 'PROTECTED'
        ? b.member_id !== null &&
          b.protected_from !== null &&
          b.protected_through !== null &&
          b.protected_through >= b.protected_from
        : b.member_id === null && b.protected_from === null && b.protected_through === null,
    'Review the protected member and term dates',
  );
router.get('/', async (c) => {
  const asOf = c.req.query('as_of');
  if (!asOf || !isIsoCalendarDate(asOf)) return c.json({ error: 'valid_as_of_required' }, 400);
  return c.json({ asOf, records: await loadTenureAsOf(c.env.DB, asOf) });
});
router.get('/history/:seat', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id,revision,effective_on AS effectiveOn,status,member_id AS memberId,protected_from AS protectedFrom,protected_through AS protectedThrough,source_ref AS sourceRef,reason,actor_subject AS actorSubject FROM staffing_tenure_evidence WHERE staffing_position_id=? ORDER BY revision DESC',
  )
    .bind(c.req.param('seat'))
    .all();
  return c.json({ records: rows.results });
});
router.post('/', requireStepUpAuth(), async (c) => {
  const parsed = BodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify(body);
  const receipt = () =>
    c.env.DB.prepare(
      'SELECT id,revision,actor_subject,request_json FROM staffing_tenure_evidence WHERE idempotency_key=?',
    )
      .bind(key)
      .first<{ id: string; revision: number; actor_subject: string; request_json: string }>();
  const existing = await receipt();
  if (existing)
    return existing.actor_subject === actor && existing.request_json === request
      ? c.json({ id: existing.id, revision: existing.revision, replayed: true })
      : c.json({ error: 'idempotency_key_reused' }, 409);
  const id = ulid();
  const revision = body.expected_revision + 1;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO staffing_tenure_evidence (id,staffing_position_id,revision,effective_on,status,member_id,protected_from,protected_through,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        body.staffing_position_id,
        revision,
        body.effective_on,
        body.status,
        body.member_id,
        body.protected_from,
        body.protected_through,
        body.source_ref,
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
        targetKind: 'staffing_tenure_evidence',
        targetId: id,
        reason: body.reason,
        afterState: { ...body, revision },
      }),
    ]);
  } catch {
    const concurrent = await receipt();
    if (concurrent?.actor_subject === actor && concurrent.request_json === request)
      return c.json({ id: concurrent.id, revision: concurrent.revision, replayed: true });
    return c.json({ error: 'tenure_evidence_identity_revision_or_date_changed' }, 409);
  }
  return c.json({ id, revision, replayed: false }, 201);
});
export default router;
