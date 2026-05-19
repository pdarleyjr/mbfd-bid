import { type JwtPayload, ReasonCodeSchema } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { positionRules, ruleBooks } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { isReasonValidForAction } from '../../lib/reason-codes.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
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

const RankSchema = z.enum(['FF', 'LT', 'CPT', 'DC']);

const RequiredCriteriaSchema = z.object({
  rank: z.array(RankSchema),
  credentials: z.array(z.string().min(1)),
  custom: z.array(z.enum(['paramedic', 'driver_engineer', 'non_probationary'])),
});

const PointsPreferenceSchema = z.object({
  max: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      points: z.number().int(),
      credential: z.string().min(1),
      requiresOpsPair: z.boolean(),
    }),
  ),
});

const TieBreakChainSchema = z
  .array(z.enum(['points', 'so_points', 'mo_points', 'rsc_seniority', 'rank_seniority']))
  .min(1);

const RulePatchSchema = z
  .object({
    required_criteria: RequiredCriteriaSchema.optional(),
    points_preference: PointsPreferenceSchema.optional(),
    tie_break_chain: TieBreakChainSchema.optional(),
    notes: z.string().max(2000).nullable().optional(),
    reason_code: ReasonCodeSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .refine(
    (v) =>
      v.required_criteria !== undefined ||
      v.points_preference !== undefined ||
      v.tie_break_chain !== undefined ||
      v.notes !== undefined,
    { message: 'at least one rule field must be patched' },
  );

router.patch('/:id{\\d+}', requireStepUpAuth(), async (c) => {
  const id = Number(c.req.param('id'));
  const raw = await c.req.json().catch(() => null);
  const parsed = RulePatchSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const patch = parsed.data;

  if (!isReasonValidForAction('override_rule', patch.reason_code)) {
    return c.json({ error: 'invalid_reason_for_action', reason_code: patch.reason_code }, 400);
  }

  const db = getDb(c.env.DB);
  const existing = await db.select().from(positionRules).where(eq(positionRules.id, id)).get();
  if (existing === undefined) return c.json({ error: 'not_found' }, 404);

  // Only drafts are editable; published rulebooks are immutable.
  const book = await db
    .select()
    .from(ruleBooks)
    .where(eq(ruleBooks.version, existing.ruleBookVersion))
    .get();
  if (book === undefined) return c.json({ error: 'rule_book_missing' }, 500);
  if (book.status !== 'draft') {
    return c.json({ error: 'rule_book_immutable', status: book.status }, 409);
  }

  const setObj: Partial<typeof positionRules.$inferInsert> = {};
  if (patch.required_criteria !== undefined)
    setObj.requiredCriteriaJson = JSON.stringify(patch.required_criteria);
  if (patch.points_preference !== undefined)
    setObj.pointsPreferenceJson = JSON.stringify(patch.points_preference);
  if (patch.tie_break_chain !== undefined)
    setObj.tieBreakChainJson = JSON.stringify(patch.tie_break_chain);
  if (patch.notes !== undefined) setObj.notes = patch.notes;

  await db.update(positionRules).set(setObj).where(eq(positionRules.id, id));
  const after = await db.select().from(positionRules).where(eq(positionRules.id, id)).get();

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'override_rule',
    targetKind: 'position_rule',
    targetId: String(id),
    reason: patch.reason,
    beforeState: existing,
    afterState: after,
  });

  return c.json({ rule: after });
});

export default router;
