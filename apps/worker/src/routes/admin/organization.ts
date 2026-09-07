import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { auditInsertStatement } from '../../lib/audit.js';
import { operationalDate } from '../../lib/operational-date.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
const VersionSchema = z
  .object({
    display_name: z.string().trim().min(1).max(160),
    parent_id: z.string().min(1).nullable(),
    effective_on: z.string().refine(isIsoCalendarDate),
    status: z.enum(['active', 'retired']),
    expected_revision: z.number().int().nonnegative(),
    evidence_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
const CreateSchema = VersionSchema.extend({
  kind: z.enum(['STATION', 'GROUP', 'APPARATUS']),
}).strict();

export const ORGANIZATION_AS_OF_SQL = `SELECT u.id,u.kind,v.revision,v.display_name AS name,v.parent_id AS parentId,
  v.effective_on AS effectiveOn,v.status,
  (SELECT MAX(revision) FROM organization_unit_versions WHERE unit_id=u.id) AS latestRevision
  FROM organization_units u JOIN organization_unit_versions v ON v.unit_id=u.id
    AND v.revision=(SELECT revision FROM organization_unit_versions WHERE unit_id=u.id AND effective_on<=? ORDER BY effective_on DESC,revision DESC LIMIT 1)`;

router.get('/', async (c) => {
  const date = c.req.query('as_of') ?? operationalDate();
  if (!isIsoCalendarDate(date)) return c.json({ error: 'invalid_as_of' }, 400);
  const entries = await c.env.DB.prepare(
    `${ORGANIZATION_AS_OF_SQL} ORDER BY u.kind,v.display_name,u.id`,
  )
    .bind(date)
    .all();
  return c.json({ asOf: date, units: entries.results });
});

router.get('/:id/history', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM organization_unit_versions WHERE unit_id=? ORDER BY revision',
  )
    .bind(c.req.param('id'))
    .all();
  return c.json({ history: rows.results });
});

router.get('/seats/links', async (c) => {
  const date = c.req.query('as_of') ?? operationalDate();
  if (!isIsoCalendarDate(date)) return c.json({ error: 'invalid_as_of' }, 400);
  const links =
    await c.env.DB.prepare(`SELECT seat.id AS staffingPositionId,link.organization_unit_id AS organizationUnitId,
    link.effective_on AS effectiveOn,COALESCE(link.revision,0) AS revision,
    COALESCE((SELECT MAX(revision) FROM organization_staffing_links WHERE staffing_position_id=seat.id),0) AS latestRevision
    FROM staffing_positions seat LEFT JOIN organization_staffing_links link ON link.staffing_position_id=seat.id
      AND link.revision=(SELECT revision FROM organization_staffing_links WHERE staffing_position_id=seat.id AND effective_on<=? ORDER BY effective_on DESC,revision DESC LIMIT 1)
    WHERE seat.review_status IN ('approved','retired') AND (seat.active_from IS NULL OR seat.active_from<=?) AND (seat.active_to IS NULL OR seat.active_to>=?)`)
      .bind(date, date, date)
      .all();
  return c.json({ asOf: date, links: links.results });
});

router.get('/:id/dependencies', async (c) => {
  const id = c.req.param('id');
  const date = c.req.query('as_of') ?? operationalDate();
  if (!isIsoCalendarDate(date)) return c.json({ error: 'invalid_as_of' }, 400);
  const children =
    await c.env.DB.prepare(`SELECT DISTINCT child.unit_id AS id,child.display_name AS name FROM organization_unit_versions child
    WHERE child.parent_id=? AND child.status='active' AND NOT EXISTS (SELECT 1 FROM organization_unit_versions successor
      WHERE successor.unit_id=child.unit_id AND successor.revision>child.revision AND successor.effective_on<=MAX(?,child.effective_on))`)
      .bind(id, date)
      .all();
  const seats =
    await c.env.DB.prepare(`SELECT DISTINCT seat.id,seat.stable_slot_key AS stableSlotKey FROM organization_staffing_links link
    JOIN staffing_positions seat ON seat.id=link.staffing_position_id WHERE link.organization_unit_id=?
      AND (seat.active_to IS NULL OR seat.active_to>=MAX(?,link.effective_on))
      AND NOT EXISTS (SELECT 1 FROM organization_staffing_links successor WHERE successor.staffing_position_id=link.staffing_position_id
        AND successor.revision>link.revision AND successor.effective_on<=MAX(?,link.effective_on))`)
      .bind(id, date, date)
      .all();
  return c.json({
    asOf: date,
    children: children.results,
    seats: seats.results,
    retirementBlocked: children.results.length + seats.results.length > 0,
  });
});

router.on(['POST', 'PATCH'], ['/', '/:id'], requireStepUpAuth(), async (c) => {
  const isNew = c.req.method === 'POST' && !c.req.param('id');
  if (!isNew && c.req.method !== 'PATCH') return c.json({ error: 'method_not_allowed' }, 405);
  const parsed = (isNew ? CreateSchema : VersionSchema).safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  if (isNew && (body.expected_revision !== 0 || body.status !== 'active'))
    return c.json({ error: 'new_organization_requires_initial_active_revision' }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify({
    operation: isNew ? 'create' : 'update',
    id: c.req.param('id') ?? null,
    body,
  });
  const replay = async () => {
    const prior = await c.env.DB.prepare(
      'SELECT * FROM organization_command_receipts WHERE idempotency_key=?',
    )
      .bind(key)
      .first<{ actor_subject: string; request_json: string; response_json: string }>();
    if (!prior) return null;
    return prior.actor_subject === actor && prior.request_json === request
      ? (JSON.parse(prior.response_json) as Record<string, unknown>)
      : false;
  };
  const prior = await replay();
  if (prior === false) return c.json({ error: 'idempotency_key_reused' }, 409);
  if (prior) return c.json({ ...prior, replayed: true });
  const id = isNew ? ulid() : c.req.param('id');
  if (!id) return c.json({ error: 'not_found' }, 404);
  const existing = isNew
    ? null
    : await c.env.DB.prepare(`SELECT u.kind,v.* FROM organization_units u JOIN organization_unit_versions v ON v.unit_id=u.id
    WHERE u.id=? ORDER BY v.revision DESC LIMIT 1`)
        .bind(id)
        .first<{ kind: string; revision: number }>();
  if (!isNew && !existing) return c.json({ error: 'not_found' }, 404);
  if (existing && existing.revision !== body.expected_revision)
    return c.json({ error: 'organization_revision_changed' }, 409);
  const response = {
    unit: {
      id,
      kind: existing?.kind ?? ('kind' in body ? body.kind : null),
      name: body.display_name,
      parentId: body.parent_id,
      effectiveOn: body.effective_on,
      status: body.status,
      revision: body.expected_revision + 1,
    },
  };
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  if (isNew)
    statements.push(
      c.env.DB.prepare('INSERT INTO organization_units (id,kind,created_at) VALUES (?,?,?)').bind(
        id,
        response.unit.kind,
        now,
      ),
    );
  statements.push(
    c.env.DB.prepare(`INSERT INTO organization_unit_versions (unit_id,revision,display_name,parent_id,effective_on,status,evidence_ref,actor_subject,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
      id,
      response.unit.revision,
      body.display_name,
      body.parent_id,
      body.effective_on,
      body.status,
      body.evidence_ref,
      actor,
      body.reason,
      now,
    ),
  );
  statements.push(
    c.env.DB.prepare(
      'INSERT INTO organization_command_receipts (idempotency_key,actor_subject,request_json,response_json,created_at) VALUES (?,?,?,?,?)',
    ).bind(key, actor, request, JSON.stringify(response), now),
  );
  statements.push(
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'organization_change',
      targetKind: 'organization',
      targetId: id,
      beforeState: existing,
      afterState: response.unit,
      reason: body.reason,
      clientMeta: { organization_key: key },
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const retry = await replay();
    if (retry) return c.json({ ...retry, replayed: true });
    if (String(error).includes('active or future dependencies'))
      return c.json({ error: 'organization_dependencies_require_review' }, 409);
    return c.json({ error: 'organization_revision_parent_or_date_changed' }, 409);
  }
  return c.json({ ...response, replayed: false }, isNew ? 201 : 200);
});

router.post('/seats/:id/link', requireStepUpAuth(), async (c) => {
  const schema = VersionSchema.pick({
    effective_on: true,
    expected_revision: true,
    evidence_ref: true,
    reason: true,
  })
    .extend({ organization_unit_id: z.string().min(1).nullable() })
    .strict();
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const id = c.req.param('id');
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify({ operation: 'seat-link', id, body });
  const prior = await c.env.DB.prepare(
    'SELECT * FROM organization_command_receipts WHERE idempotency_key=?',
  )
    .bind(key)
    .first<{ actor_subject: string; request_json: string; response_json: string }>();
  if (prior)
    return prior.actor_subject === actor && prior.request_json === request
      ? c.json({ ...JSON.parse(prior.response_json), replayed: true })
      : c.json({ error: 'idempotency_key_reused' }, 409);
  const response = {
    staffingPositionId: id,
    organizationUnitId: body.organization_unit_id,
    effectiveOn: body.effective_on,
    revision: body.expected_revision + 1,
  };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO organization_staffing_links (staffing_position_id,revision,organization_unit_id,effective_on,evidence_ref,actor_subject,reason,created_at) VALUES (?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        response.revision,
        body.organization_unit_id,
        body.effective_on,
        body.evidence_ref,
        actor,
        body.reason,
        Date.now(),
      ),
      c.env.DB.prepare(
        'INSERT INTO organization_command_receipts (idempotency_key,actor_subject,request_json,response_json,created_at) VALUES (?,?,?,?,?)',
      ).bind(key, actor, request, JSON.stringify(response), Date.now()),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'organization_change',
        targetKind: 'staffing_position',
        targetId: id,
        afterState: response,
        reason: body.reason,
        clientMeta: { organization_key: key },
      }),
    ]);
  } catch {
    return c.json({ error: 'organization_link_revision_or_dependency_changed' }, 409);
  }
  return c.json({ ...response, replayed: false });
});

export default router;
