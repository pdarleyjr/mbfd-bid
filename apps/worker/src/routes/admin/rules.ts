import type { JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { positionRules } from '../../db/schema.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

type RuleRow = typeof positionRules.$inferSelect;

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parseRule(row: RuleRow) {
  return {
    id: row.id,
    ruleBookVersion: row.ruleBookVersion,
    positionId: row.positionId,
    templateVersion: row.templateVersion,
    requiredCriteria: safeJson(row.requiredCriteriaJson),
    pointsPreference: safeJson(row.pointsPreferenceJson),
    tieBreakChain: safeJson(row.tieBreakChainJson),
    notes: row.notes,
  };
}

router.get('/', async (c) => {
  const ruleBookVersion = c.req.query('rule_book_version');
  if (!ruleBookVersion) {
    return c.json({ error: 'rule_book_version required' }, 400);
  }

  const db = getDb(c.env.DB);

  const list = await db
    .select()
    .from(positionRules)
    .where(eq(positionRules.ruleBookVersion, ruleBookVersion))
    .all();

  return c.json({ rules: list.map(parseRule), ruleBookVersion, count: list.length });
});

router.get('/:id{\\d+}', async (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);

  const row = await db.select().from(positionRules).where(eq(positionRules.id, id)).get();

  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ rule: parseRule(row) });
});

export default router;
