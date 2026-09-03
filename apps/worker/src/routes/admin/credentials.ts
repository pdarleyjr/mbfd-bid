import type { JwtPayload } from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { credentials, memberCredentials, members } from '../../db/schema.js';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  type XlsxParseResult,
  parseCredentialsXlsx,
  parseLegacyWideMatrix,
} from '../../lib/xlsx-cred-parser.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

const CredentialWriteSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    fy_points_default: z.number().int().min(0),
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

async function catalogCredentialById(db: ReturnType<typeof getDb>, id: number) {
  return db
    .select({
      id: credentials.id,
      name: credentials.name,
      fyPointsDefault: credentials.fyPointsDefault,
      holderCount: sql<number>`count(${memberCredentials.memberId})`,
    })
    .from(credentials)
    .leftJoin(memberCredentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(credentials.id, id))
    .groupBy(credentials.id)
    .get();
}

function sameCatalogRequest(state: unknown, input: z.infer<typeof CredentialWriteSchema>): boolean {
  if (typeof state !== 'object' || state === null || !('request' in state)) return false;
  const request = (state as { request?: unknown }).request;
  return JSON.stringify(request) === JSON.stringify(input);
}

async function existingCatalogReceipt(
  db: D1Database,
  idempotencyKey: string,
): Promise<{ action: string; beforeState: unknown; afterState: unknown } | undefined> {
  const row = await db
    .prepare(
      `SELECT action, before_state, after_state FROM audit_log
       WHERE bid_session_id IS NULL AND client_meta = ?
       ORDER BY created_at DESC, seq DESC LIMIT 1`,
    )
    .bind(JSON.stringify({ idempotency_key: idempotencyKey }))
    .first<{
      action: string;
      before_state: string | null;
      after_state: string | null;
    }>();
  if (row === null) return undefined;
  try {
    return {
      action: row.action,
      beforeState: row.before_state === null ? null : JSON.parse(row.before_state),
      afterState: row.after_state === null ? null : JSON.parse(row.after_state),
    };
  } catch {
    return undefined;
  }
}

router.use('*', requireAdmin);

router.post('/import', requireStepUpAuth(), async (c) => {
  const mode = c.req.query('mode') ?? 'normalized';
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'file_required' }, 400);
  }

  const buf = await file.arrayBuffer();

  let result: XlsxParseResult<{ name: string; fyPointsDefault: number }>;
  if (mode === 'legacy_wide_matrix') {
    const metadataColumnsParam = c.req.query('metadata_columns');
    const metadataColumns = Math.max(0, Number(metadataColumnsParam ?? 0));
    result = await parseLegacyWideMatrix(buf, { metadataColumns });
  } else {
    result = await parseCredentialsXlsx(buf);
  }

  const db = getDb(c.env.DB);
  const existingNames = new Set(
    (await db.select({ name: credentials.name }).from(credentials).all()).map(
      (credential) => credential.name,
    ),
  );
  let inserted = 0;
  let updated = 0;

  for (const row of result.ok) {
    if (existingNames.has(row.name)) {
      updated += 1;
    } else {
      inserted += 1;
      existingNames.add(row.name);
    }
  }

  // This is intentionally one D1 transaction: a credentials import is not
  // visible unless its authoritative receipt is visible too.
  await c.env.DB.batch([
    ...result.ok.map((row) =>
      c.env.DB.prepare(
        `INSERT INTO credentials (name, fy_points_default)
           VALUES (?, ?)
           ON CONFLICT(name) DO UPDATE SET fy_points_default = excluded.fy_points_default`,
      ).bind(row.name, row.fyPointsDefault),
    ),
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'credentials_import',
      afterState: { inserted, updated, errorCount: result.errors.length },
    }),
  ]);
  return c.json({ inserted, updated, errors: result.errors });
});

/** Creates a catalog entry without exposing SQL or a direct schema write to operators. */
router.post('/', requireStepUpAuth(), async (c) => {
  const parsed = CredentialWriteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const idempotencyKey = catalogIdempotencyKey(c);
  if (idempotencyKey === null) return c.json({ error: 'idempotency_key_required' }, 400);
  const input = parsed.data;
  const existingReceipt = await existingCatalogReceipt(c.env.DB, idempotencyKey);
  if (existingReceipt !== undefined) {
    if (
      existingReceipt.action === 'credential_create' &&
      sameCatalogRequest(existingReceipt.beforeState, input) &&
      typeof existingReceipt.afterState === 'object' &&
      existingReceipt.afterState !== null &&
      'name' in existingReceipt.afterState
    ) {
      const credentialName = String((existingReceipt.afterState as { name: unknown }).name);
      const replayId = await getDb(c.env.DB)
        .select({ id: credentials.id })
        .from(credentials)
        .where(eq(credentials.name, credentialName))
        .get();
      const replay =
        replayId === undefined
          ? undefined
          : await catalogCredentialById(getDb(c.env.DB), replayId.id);
      if (replay !== undefined) return c.json({ replayed: true, credential: replay });
    }
    return c.json({ error: 'idempotency_key_reused' }, 409);
  }

  const db = getDb(c.env.DB);
  const duplicate = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.name, input.name))
    .get();
  if (duplicate !== undefined) return c.json({ error: 'credential_name_exists' }, 409);

  const now = new Date();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO credentials (name, fy_points_default) VALUES (?, ?)').bind(
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
        clientMeta: { idempotency_key: idempotencyKey },
      },
      now,
    ),
  ]);
  const created = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.name, input.name))
    .get();
  if (created === undefined) return c.json({ error: 'credential_create_rejected' }, 409);
  const credential = await catalogCredentialById(db, created.id);
  if (credential === undefined) return c.json({ error: 'credential_create_rejected' }, 409);
  return c.json({ replayed: false, credential }, 201);
});

router.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  const limit = Math.min(500, Math.max(1, Number(limitParam ?? 100)));
  const offset = Math.max(0, Number(offsetParam ?? 0));

  const db = getDb(c.env.DB);

  const list = await db
    .select({
      id: credentials.id,
      name: credentials.name,
      fyPointsDefault: credentials.fyPointsDefault,
      holderCount: sql<number>`count(${memberCredentials.memberId})`,
    })
    .from(credentials)
    .leftJoin(memberCredentials, eq(memberCredentials.credentialId, credentials.id))
    .groupBy(credentials.id)
    .orderBy(credentials.name)
    .limit(limit)
    .offset(offset)
    .all();
  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(credentials).get();

  return c.json({ credentials: list as CredentialCatalogRow[], total: totalRow?.n ?? 0 });
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

  const db = getDb(c.env.DB);
  const credential = await catalogCredentialById(db, id);

  if (credential === undefined) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ credential });
});

router.patch('/:id{\\d+}', requireStepUpAuth(), async (c) => {
  const id = Number(c.req.param('id'));
  const parsed = CredentialWriteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const idempotencyKey = catalogIdempotencyKey(c);
  if (idempotencyKey === null) return c.json({ error: 'idempotency_key_required' }, 400);
  const input = parsed.data;
  const db = getDb(c.env.DB);
  const existingReceipt = await existingCatalogReceipt(c.env.DB, idempotencyKey);
  if (existingReceipt !== undefined) {
    if (
      existingReceipt.action === 'credential_update' &&
      sameCatalogRequest(existingReceipt.beforeState, input)
    ) {
      const replay = await catalogCredentialById(db, id);
      if (replay !== undefined) return c.json({ replayed: true, credential: replay });
    }
    return c.json({ error: 'idempotency_key_reused' }, 409);
  }
  const before = await catalogCredentialById(db, id);
  if (before === undefined) return c.json({ error: 'not_found' }, 404);
  const duplicate = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.name, input.name))
    .get();
  if (duplicate !== undefined && duplicate.id !== id)
    return c.json({ error: 'credential_name_exists' }, 409);
  const after = {
    id,
    name: input.name,
    fyPointsDefault: input.fy_points_default,
    holderCount: before.holderCount,
  };
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE credentials SET name = ?, fy_points_default = ? WHERE id = ?').bind(
      input.name,
      input.fy_points_default,
      id,
    ),
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'credential_update',
      targetKind: 'credential',
      targetId: String(id),
      beforeState: { request: input, credential: before },
      afterState: { credential: after },
      reason: input.reason,
      clientMeta: { idempotency_key: idempotencyKey },
    }),
  ]);
  return c.json({ replayed: false, credential: after });
});

export default router;
