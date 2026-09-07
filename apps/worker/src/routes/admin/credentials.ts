import type { JwtPayload } from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { credentials, memberCredentials, members } from '../../db/schema.js';
import { loadConfigurationReceipt } from '../../lib/admin-configuration-receipt.js';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  CATALOG_SELECT,
  CatalogEditSchema,
  catalogDependencies,
  editCatalogEntry,
  loadCatalogEntry,
} from '../../lib/credential-catalog.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

const CredentialWriteSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    fy_points_default: z.number().int().min(0).max(10000),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

type CredentialCatalogRow = {
  id: number;
  name: string;
  fyPointsDefault: number;
  holderCount: number;
};

function catalogIdempotencyKey(c: { req: { header(name: string): string | undefined } }) {
  const value = c.req.header('Idempotency-Key');
  if (value === undefined || value.trim().length === 0) return null;
  if (value !== value.trim() || value.length > 256) return null;
  return value;
}

router.use('*', requireAdmin);

router.post('/import', requireStepUpAuth(), (c) =>
  c.json(
    {
      error: 'reviewed_catalog_import_required',
      previewPath: '/api/admin/credential-imports/preview',
    },
    409,
  ),
);

/** Creates one stable identity with an actor-bound immutable response receipt. */
router.post('/', requireStepUpAuth(), async (c) => {
  const parsed = CredentialWriteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const key = catalogIdempotencyKey(c);
  if (key === null) return c.json({ error: 'idempotency_key_required' }, 400);
  const input = parsed.data;
  const receiptInput = {
    key,
    actorSubject: String(c.get('claims').sub),
    operation: 'credential.create',
    request: input,
  };
  const prior = await loadConfigurationReceipt(c.env.DB, receiptInput);
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const duplicate = await c.env.DB.prepare(
    'SELECT id FROM credentials WHERE name=? COLLATE NOCASE UNION SELECT credential_id AS id FROM credential_catalog_metadata WHERE display_name=? COLLATE NOCASE',
  )
    .bind(input.name, input.name)
    .first();
  if (duplicate) return c.json({ error: 'credential_name_exists' }, 409);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO credentials (name,fy_points_default) VALUES (?,?)').bind(
        input.name,
        input.fy_points_default,
      ),
      auditInsertStatement(
        c.env.DB,
        {
          bidSessionId: null,
          actorType: 'admin',
          actorId: c.get('claims').member_id,
          action: 'credential_create',
          targetKind: 'credential',
          targetId: input.name,
          beforeState: { request: input },
          afterState: { name: input.name, fyPointsDefault: input.fy_points_default },
          reason: input.reason,
          clientMeta: { idempotency_key: key },
        },
        new Date(),
        true,
      ),
      c.env.DB.prepare(`INSERT INTO admin_configuration_receipts (idempotency_key,actor_subject,operation,request_json,response_json,created_at)
      SELECT ?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,json_object('credential',json_object('id',c.id,'name',c.name,'policyName',c.name,'fyPointsDefault',c.fy_points_default,'holderCount',0,'revision',0,'retiredOn',NULL)),? FROM credentials c WHERE c.name=?`).bind(
        key,
        receiptInput.actorSubject,
        receiptInput.operation,
        JSON.stringify(input),
        Date.now(),
        input.name,
      ),
    ]);
  } catch {
    const replay = await loadConfigurationReceipt(c.env.DB, receiptInput);
    if (replay)
      return replay.ok
        ? c.json({ ...replay.response, replayed: true })
        : c.json({ error: replay.error }, 409);
    return c.json({ error: 'credential_name_collision_or_create_failed' }, 409);
  }
  const saved = await loadConfigurationReceipt(c.env.DB, receiptInput);
  if (!saved?.ok) return c.json({ error: 'credential_create_receipt_missing' }, 409);
  return c.json({ ...saved.response, replayed: false }, 201);
});

router.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  const limit = Math.min(500, Math.max(1, Number(limitParam ?? 100)));
  const offset = Math.max(0, Number(offsetParam ?? 0));

  const db = getDb(c.env.DB);

  const list = (
    await c.env.DB.prepare(`${CATALOG_SELECT} ORDER BY name LIMIT ? OFFSET ?`)
      .bind(limit, offset)
      .all()
  ).results;
  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(credentials).get();

  return c.json({ credentials: list as CredentialCatalogRow[], total: totalRow?.n ?? 0 });
});

router.get('/:id{\\d+}/dependencies', async (c) => {
  const dependencies = await catalogDependencies(c.env.DB, Number(c.req.param('id')));
  if (!dependencies) return c.json({ error: 'not_found' }, 404);
  return c.json(dependencies);
});

router.get('/:id{\\d+}/holders', async (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);
  const credential = await db.select().from(credentials).where(eq(credentials.id, id)).get();
  if (credential === undefined) return c.json({ error: 'not_found' }, 404);
  const holders = await db
    .select({
      memberId: members.id,
      employeeId: members.employeeId,
      firstName: members.firstName,
      lastName: members.lastName,
    })
    .from(memberCredentials)
    .innerJoin(members, eq(members.id, memberCredentials.memberId))
    .where(eq(memberCredentials.credentialId, id))
    .orderBy(members.lastName, members.firstName, members.id)
    .all();
  return c.json({
    credential,
    holders: holders.map((holder) => ({
      ...holder,
      historyHref: `/admin/personnel/qualifications?memberId=${holder.memberId}`,
      legacyReference: true,
    })),
    lifecycleNotice: 'Legacy credential references do not establish current qualification status.',
  });
});

router.get('/:id{\\d+}', async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);

  const credential = await loadCatalogEntry(c.env.DB, id);

  if (credential == null) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ credential });
});

router.patch('/:id{\\d+}', requireStepUpAuth(), async (c) => {
  const id = Number(c.req.param('id'));
  const parsed = CatalogEditSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const key = catalogIdempotencyKey(c);
  if (key === null) return c.json({ error: 'idempotency_key_required' }, 400);
  const claims = c.get('claims');
  const result = await editCatalogEntry(c.env.DB, {
    id,
    key,
    actorSubject: String(claims.sub),
    actorId: claims.member_id,
    body: parsed.data,
  });
  if (!result.ok) return c.json({ error: result.error }, result.error === 'not_found' ? 404 : 409);
  return c.json({ replayed: result.replayed, credential: result.credential });
});

export default router;
