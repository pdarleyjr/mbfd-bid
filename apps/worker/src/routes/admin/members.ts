import { MemberImportRowSchema } from '@mbfd/shared';
import type { JwtPayload } from '@mbfd/shared';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { credentials as credentialsTable, memberCredentials, members } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { parseCsv } from '../../lib/csv-parser.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const MemberPatchSchema = z
  .object({
    rank: z.enum(['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF']).optional(),
    bid_category: z.enum(['OFC', 'FF', 'EXCLUDED']).optional(),
    rsc_seniority: z.number().int().nonnegative().optional(),
    rank_seniority: z.number().int().nonnegative().nullable().optional(),
    is_probationary: z.boolean().optional(),
    credentials: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

router.post('/import', requireStepUpAuth(), async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'file_required' }, 400);
  }

  const text = await file.text();
  const { ok, errors } = await parseCsv(text, MemberImportRowSchema);

  const db = getDb(c.env.DB);
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const row of ok) {
    const existing = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.employeeId, row.employeeId))
      .get();

    if (existing !== undefined) {
      await db
        .update(members)
        .set({
          firstName: row.firstName,
          lastName: row.lastName,
          rank: row.rank,
          bidCategory: row.bidCategory,
          rscSeniority: row.rscSeniority,
          hiredAt: row.hiredAt ?? null,
          promotedAt: row.promotedAt ?? null,
          updatedAt: now,
        })
        .where(eq(members.employeeId, row.employeeId));
      updated += 1;
    } else {
      await db.insert(members).values({
        employeeId: row.employeeId,
        firstName: row.firstName,
        lastName: row.lastName,
        rank: row.rank,
        bidCategory: row.bidCategory,
        rscSeniority: row.rscSeniority,
        hiredAt: row.hiredAt ?? null,
        promotedAt: row.promotedAt ?? null,
        isProbationary: false,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub ?? null,
    action: 'members_import',
    afterState: { inserted, updated, errorCount: errors.length },
  });
  return c.json({ inserted, updated, errors });
});

router.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');
  const bidCategory = c.req.query('bid_category');
  const rank = c.req.query('rank');

  const limit = Math.min(500, Math.max(1, Number(limitParam ?? 100)));
  const offset = Math.max(0, Number(offsetParam ?? 0));

  const db = getDb(c.env.DB);

  const filters: SQL[] = [];
  if (bidCategory) {
    filters.push(eq(members.bidCategory, bidCategory as 'OFC' | 'FF' | 'EXCLUDED'));
  }
  if (rank) {
    filters.push(eq(members.rank, rank as 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF'));
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const list = await db.select().from(members).where(where).limit(limit).offset(offset).all();

  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(members).where(where).get();

  return c.json({ members: list, total: totalRow?.n ?? 0 });
});

router.get('/:id{\\d+}', async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);

  const db = getDb(c.env.DB);
  const member = await db.select().from(members).where(eq(members.id, id)).get();

  if (member === undefined) {
    return c.json({ error: 'not_found' }, 404);
  }

  const creds = await db
    .select({ id: credentialsTable.id, name: credentialsTable.name })
    .from(memberCredentials)
    .innerJoin(credentialsTable, eq(memberCredentials.credentialId, credentialsTable.id))
    .where(eq(memberCredentials.memberId, id))
    .all();

  return c.json({ member, credentials: creds });
});

// PATCH /api/admin/members/:id
router.patch('/:id{\\d+}', requireStepUpAuth(), async (c) => {
  const id = Number(c.req.param('id'));
  const raw = await c.req.json().catch(() => null);
  const parsed = MemberPatchSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const patch = parsed.data;

  const db = getDb(c.env.DB);
  const existing = await db.select().from(members).where(eq(members.id, id)).get();
  if (existing === undefined) return c.json({ error: 'not_found' }, 404);

  // Resolve credential names -> ids; reject unknown names.
  let resolvedCredIds: number[] | undefined;
  if (patch.credentials !== undefined) {
    const all = await db
      .select({ id: credentialsTable.id, name: credentialsTable.name })
      .from(credentialsTable)
      .all();
    const byName = new Map(all.map((r) => [r.name, r.id]));
    const missing: string[] = [];
    resolvedCredIds = [];
    for (const name of patch.credentials) {
      const cid = byName.get(name);
      if (cid === undefined) missing.push(name);
      else resolvedCredIds.push(cid);
    }
    if (missing.length > 0) {
      return c.json({ error: 'unknown_credentials', missing }, 400);
    }
  }

  const now = new Date();
  const setObj: Partial<typeof members.$inferInsert> = { updatedAt: now };
  if (patch.rank !== undefined) setObj.rank = patch.rank;
  if (patch.bid_category !== undefined) setObj.bidCategory = patch.bid_category;
  if (patch.rsc_seniority !== undefined) setObj.rscSeniority = patch.rsc_seniority;
  if (patch.rank_seniority !== undefined) setObj.rankSeniority = patch.rank_seniority;
  if (patch.is_probationary !== undefined) setObj.isProbationary = patch.is_probationary;

  await db.update(members).set(setObj).where(eq(members.id, id));

  if (resolvedCredIds !== undefined) {
    await db.delete(memberCredentials).where(eq(memberCredentials.memberId, id));
    for (const cid of resolvedCredIds) {
      await db.insert(memberCredentials).values({ memberId: id, credentialId: cid });
    }
  }

  const updated = await db.select().from(members).where(eq(members.id, id)).get();

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'override_cert',
    targetKind: 'member',
    targetId: String(id),
    beforeState: existing,
    afterState: updated,
  });

  return c.json({ member: updated });
});

export default router;
