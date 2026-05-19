import { AuditQuerySchema, type JwtPayload } from '@mbfd/shared';
import { type SQL, and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { auditLog } from '../../db/schema.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.get('/', async (c) => {
  // c.req.queries() returns Record<string, string[]>; flatten to first value
  // per key for the Zod schema.
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.req.queries())) {
    if (v.length > 0 && v[0] !== undefined) flat[k] = v[0];
  }
  const parsed = AuditQuerySchema.safeParse(flat);
  if (!parsed.success) {
    return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400);
  }
  const q = parsed.data;

  const filters: SQL[] = [];
  if (q.from !== undefined) filters.push(gte(auditLog.createdAt, new Date(q.from)));
  if (q.to !== undefined) filters.push(lte(auditLog.createdAt, new Date(q.to)));
  if (q.actor_id !== undefined) filters.push(eq(auditLog.actorId, q.actor_id));
  if (q.actor_type !== undefined) filters.push(eq(auditLog.actorType, q.actor_type));
  if (q.action !== undefined) filters.push(eq(auditLog.action, q.action));
  if (q.target_id !== undefined) filters.push(eq(auditLog.targetId, q.target_id));
  if (q.bid_session_id !== undefined) filters.push(eq(auditLog.bidSessionId, q.bid_session_id));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const db = getDb(c.env.DB);
  const entries = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.seq), desc(auditLog.createdAt))
    .limit(q.limit)
    .offset(q.offset)
    .all();
  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(auditLog).where(where).get();

  return c.json({ entries, total: totalRow?.n ?? 0, limit: q.limit, offset: q.offset });
});

export default router;
