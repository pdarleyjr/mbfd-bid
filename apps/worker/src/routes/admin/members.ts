import { MemberImportRowSchema } from '@mbfd/shared';
import type { JwtPayload } from '@mbfd/shared';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { members } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { parseCsv } from '../../lib/csv-parser.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

router.post('/import', async (c) => {
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

  return c.json({ member });
});

export default router;
