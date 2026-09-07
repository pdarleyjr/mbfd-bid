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
const BodySchema = z
  .object({
    member_id: z.number().int().positive(),
    service_code: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    expected_revision: z.number().int().nonnegative(),
    effective_on: z.string().refine(isIsoCalendarDate),
    verified_months: z.number().int().min(0).max(1200).nullable(),
    source_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
router.get('/types', async (c) =>
  c.json({
    types: (await c.env.DB.prepare('SELECT id,name FROM service_credit_types ORDER BY name').all())
      .results,
  }),
);
router.post('/types', requireStepUpAuth(), async (c) => {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(160),
      source_ref: z.string().trim().min(4).max(500),
      reason: z.string().trim().min(4).max(500),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify({ operation: 'create-service-type', body: parsed.data });
  const prior = await c.env.DB.prepare(
    'SELECT actor_subject,request_json,response_json FROM annual_plan_receipts WHERE idempotency_key=?',
  )
    .bind(key)
    .first<{ actor_subject: string; request_json: string; response_json: string }>();
  if (prior)
    return prior.actor_subject === actor && prior.request_json === request
      ? c.json({ ...JSON.parse(prior.response_json), replayed: true })
      : c.json({ error: 'idempotency_key_reused' }, 409);
  const id = `SERVICE_${ulid()}`;
  const result = { id, name: parsed.data.name };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO annual_plan_receipts (idempotency_key,actor_subject,request_json,response_json,created_at) VALUES (?,?,?,?,?)',
      ).bind(key, actor, request, JSON.stringify(result), Date.now()),
      c.env.DB.prepare(
        'INSERT INTO service_credit_types (id,name,source_ref,actor_subject,created_at) VALUES (?,?,?,?,?)',
      ).bind(id, parsed.data.name, parsed.data.source_ref, actor, Date.now()),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'qualification_lifecycle',
        targetKind: 'service_credit_type',
        targetId: id,
        reason: parsed.data.reason,
        afterState: result,
      }),
    ]);
  } catch {
    return c.json({ error: 'service_type_conflict_retry' }, 409);
  }
  return c.json({ ...result, replayed: false }, 201);
});
router.get('/', async (c) => {
  const memberId = Number(c.req.query('member_id'));
  if (!Number.isInteger(memberId) || memberId <= 0)
    return c.json({ error: 'member_id_required' }, 400);
  const rows = await c.env.DB.prepare(
    'SELECT id,member_id AS memberId,service_code AS serviceCode,revision,effective_on AS effectiveOn,verified_months AS verifiedMonths,source_ref AS sourceRef,actor_subject AS actorSubject,reason,created_at AS createdAt FROM member_service_evidence WHERE member_id=? ORDER BY service_code,effective_on DESC,revision DESC',
  )
    .bind(memberId)
    .all();
  c.header('Cache-Control', 'private, no-store');
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
      'SELECT id,revision,actor_subject,request_json FROM member_service_evidence WHERE idempotency_key=?',
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
        'INSERT INTO member_service_evidence (id,member_id,service_code,revision,effective_on,verified_months,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        body.member_id,
        body.service_code,
        revision,
        body.effective_on,
        body.verified_months,
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
        targetKind: 'member_service_evidence',
        targetId: id,
        reason: body.reason,
        afterState: {
          memberId: body.member_id,
          serviceCode: body.service_code,
          verifiedMonths: body.verified_months,
          effectiveOn: body.effective_on,
          sourceRef: body.source_ref,
          revision,
        },
      }),
    ]);
  } catch {
    const concurrent = await receipt();
    if (concurrent?.actor_subject === actor && concurrent.request_json === request)
      return c.json({ id: concurrent.id, revision: concurrent.revision, replayed: true });
    return c.json({ error: 'service_evidence_member_revision_or_date_changed' }, 409);
  }
  return c.json({ id, revision, replayed: false }, 201);
});
export default router;
