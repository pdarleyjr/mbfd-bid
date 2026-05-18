import type { JwtPayload } from '@mbfd/shared';
import { type SQL, and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { positionTemplates, positions } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

router.get('/', async (c) => {
  const templateVersion = c.req.query('template_version');
  if (!templateVersion) {
    return c.json({ error: 'template_version required' }, 400);
  }

  const shift = c.req.query('shift') as 'A' | 'B' | 'C' | 'D' | undefined;
  const station = c.req.query('station');

  const db = getDb(c.env.DB);

  const filters: SQL[] = [eq(positions.templateVersion, templateVersion)];
  if (shift) {
    filters.push(eq(positions.shift, shift));
  }
  if (station) {
    filters.push(eq(positions.station, station));
  }

  const list = await db
    .select()
    .from(positions)
    .where(and(...filters))
    .all();

  return c.json({ positions: list, templateVersion, count: list.length });
});

router.post('/clone-from-year/:src_version', async (c) => {
  const srcVersion = c.req.param('src_version');
  const body = await c.req.json<{ destVersion?: string; destYear?: number }>();

  if (!body.destVersion || typeof body.destYear !== 'number') {
    return c.json({ error: 'destVersion and destYear required' }, 400);
  }

  const { destVersion, destYear } = body;

  const db = getDb(c.env.DB);

  const src = await db
    .select()
    .from(positionTemplates)
    .where(eq(positionTemplates.version, srcVersion))
    .get();

  if (!src) {
    return c.json({ error: 'src_version_not_found' }, 404);
  }

  const existing = await db
    .select()
    .from(positionTemplates)
    .where(eq(positionTemplates.version, destVersion))
    .get();

  if (existing) {
    return c.json({ error: 'dest_version_already_exists' }, 409);
  }

  const srcPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.templateVersion, srcVersion))
    .all();

  await db.insert(positionTemplates).values({ version: destVersion, effectiveYear: destYear });

  if (srcPositions.length > 0) {
    await db
      .insert(positions)
      .values(srcPositions.map((p) => ({ ...p, templateVersion: destVersion })));
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub ?? null,
    action: 'positions_clone',
    targetKind: 'position_template',
    targetId: destVersion,
    afterState: { srcVersion, destVersion, copied: srcPositions.length },
  });

  return c.json({ destVersion, destYear, copied: srcPositions.length });
});

export default router;
