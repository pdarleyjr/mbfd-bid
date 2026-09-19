import { BidOrdinalImportSchema, type JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { auditInsertStatement } from '../../lib/audit.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.get('/:year', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT id,revision,source_sha256 AS sourceSha256,source_ref AS sourceRef,entries_json AS entriesJson FROM bid_ordinal_datasets WHERE bid_year=? ORDER BY revision DESC LIMIT 1',
  )
    .bind(year)
    .first<{
      id: string;
      revision: number;
      sourceSha256: string;
      sourceRef: string;
      entriesJson: string;
    }>();
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    dataset: row
      ? {
          id: row.id,
          revision: row.revision,
          sourceSha256: row.sourceSha256,
          sourceRef: row.sourceRef,
          entries: JSON.parse(row.entriesJson),
        }
      : null,
  });
});
router.post('/', requireStepUpAuth(), async (c) => {
  const parsed = BidOrdinalImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'invalid_bid_ordinals', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify(body);
  const receipt = () =>
    c.env.DB.prepare(
      'SELECT id,revision,actor_subject,request_json FROM bid_ordinal_datasets WHERE idempotency_key=?',
    )
      .bind(key)
      .first<{ id: string; revision: number; actor_subject: string; request_json: string }>();
  const prior = await receipt();
  if (prior)
    return prior.actor_subject === actor && prior.request_json === request
      ? c.json({ id: prior.id, revision: prior.revision, replayed: true })
      : c.json({ error: 'idempotency_key_reused' }, 409);
  const id = ulid();
  const revision = body.expectedRevision + 1;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO bid_ordinal_datasets (id,bid_year,revision,source_sha256,source_ref,entries_json,actor_subject,reason,idempotency_key,request_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        body.bidYear,
        revision,
        body.sourceSha256,
        body.sourceRef,
        JSON.stringify(body.entries),
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
        targetKind: 'bid_ordinal_dataset',
        targetId: id,
        reason: body.reason,
        afterState: {
          bidYear: body.bidYear,
          revision,
          sourceSha256: body.sourceSha256,
          memberCount: body.entries.length,
        },
      }),
    ]);
  } catch {
    const concurrent = await receipt();
    if (concurrent?.actor_subject === actor && concurrent.request_json === request)
      return c.json({ id: concurrent.id, revision: concurrent.revision, replayed: true });
    return c.json({ error: 'bid_ordinal_identity_or_revision_conflict' }, 409);
  }
  return c.json({ id, revision, replayed: false }, 201);
});
export default router;
