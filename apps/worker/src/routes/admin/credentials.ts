import type { JwtPayload } from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { credentials } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { parseCredentialsXlsx, parseLegacyWideMatrix } from '../../lib/xlsx-cred-parser.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

router.post('/import', requireStepUpAuth(), async (c) => {
  const mode = c.req.query('mode') ?? 'normalized';
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'file_required' }, 400);
  }

  const buf = await file.arrayBuffer();

  let result: ReturnType<typeof parseCredentialsXlsx>;
  if (mode === 'legacy_wide_matrix') {
    const metadataColumnsParam = c.req.query('metadata_columns');
    const metadataColumns = Math.max(0, Number(metadataColumnsParam ?? 0));
    result = parseLegacyWideMatrix(buf, { metadataColumns });
  } else {
    result = parseCredentialsXlsx(buf);
  }

  const db = getDb(c.env.DB);
  let inserted = 0;
  let updated = 0;

  for (const row of result.ok) {
    const existing = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.name, row.name))
      .get();

    if (existing !== undefined) {
      await db
        .update(credentials)
        .set({ fyPointsDefault: row.fyPointsDefault })
        .where(eq(credentials.name, row.name));
      updated += 1;
    } else {
      await db.insert(credentials).values({ name: row.name, fyPointsDefault: row.fyPointsDefault });
      inserted += 1;
    }
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub ?? null,
    action: 'credentials_import',
    afterState: { inserted, updated, errorCount: result.errors.length },
  });
  return c.json({ inserted, updated, errors: result.errors });
});

router.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  const limit = Math.min(500, Math.max(1, Number(limitParam ?? 100)));
  const offset = Math.max(0, Number(offsetParam ?? 0));

  const db = getDb(c.env.DB);

  const list = await db.select().from(credentials).limit(limit).offset(offset).all();
  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(credentials).get();

  return c.json({ credentials: list, total: totalRow?.n ?? 0 });
});

router.get('/:id{\\d+}', async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);

  const db = getDb(c.env.DB);
  const credential = await db.select().from(credentials).where(eq(credentials.id, id)).get();

  if (credential === undefined) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ credential });
});

export default router;
