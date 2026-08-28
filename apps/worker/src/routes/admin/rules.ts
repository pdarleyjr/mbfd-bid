import { type JwtPayload, ReasonCodeSchema } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { positionRules, ruleBooks } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { decodePositionRule } from '../../lib/position-rule.js';
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

const RequiredCriteriaSchema = z
  .object({
    rank: z.array(RankSchema),
    credentials: z.array(z.string().min(1)),
    custom: z.array(z.enum(['paramedic', 'driver_engineer', 'non_probationary'])),
  })
  .strict();

const PointsPreferenceItemSchema = z
  .object({
    points: z.number().int().nonnegative(),
    credential: z.string().min(1),
    // Legacy fixture shape. It is accepted only so a GET -> PATCH round trip
    // cannot silently remove the all-six Operations requirement.
    gating: z.literal('ops_all_6').optional(),
    requiresOpsPair: z.boolean().optional(),
    opsGate: z.enum(['paired_operation', 'all_operations']).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const legacyOpsGate = item.gating === 'ops_all_6' ? 'all_operations' : undefined;
    const effectiveOpsGate = item.opsGate ?? legacyOpsGate;

    if (legacyOpsGate && item.opsGate && legacyOpsGate !== item.opsGate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'conflicting Operations gate fields',
      });
    }
    if (item.requiresOpsPair === true && effectiveOpsGate === 'all_operations') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'conflicting Operations gate fields',
      });
    }
    if (item.requiresOpsPair === false && effectiveOpsGate === 'paired_operation') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'conflicting Operations gate fields',
      });
    }
  })
  .transform(({ gating, opsGate, ...item }) => ({
    ...item,
    ...(opsGate !== undefined || gating !== 'ops_all_6'
      ? opsGate === undefined
        ? {}
        : { opsGate }
      : { opsGate: 'all_operations' as const }),
  }));

const PointsPreferenceSchema = z
  .object({
    max: z.number().int().nonnegative(),
    items: z.array(PointsPreferenceItemSchema),
  })
  .strict();

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
  .strict()
  .refine(
    (v) =>
      v.required_criteria !== undefined ||
      v.points_preference !== undefined ||
      v.tie_break_chain !== undefined ||
      v.notes !== undefined,
    { message: 'at least one rule field must be patched' },
  );

const RuleDeleteSchema = z
  .object({
    reason_code: ReasonCodeSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

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

  const nextRequiredCriteriaJson =
    patch.required_criteria === undefined
      ? existing.requiredCriteriaJson
      : JSON.stringify(patch.required_criteria);
  const nextPointsPreferenceJson =
    patch.points_preference === undefined
      ? existing.pointsPreferenceJson
      : JSON.stringify(patch.points_preference);
  const nextTieBreakChainJson =
    patch.tie_break_chain === undefined
      ? existing.tieBreakChainJson
      : JSON.stringify(patch.tie_break_chain);
  const candidate = decodePositionRule({
    ...existing,
    requiredCriteriaJson: nextRequiredCriteriaJson,
    pointsPreferenceJson: nextPointsPreferenceJson,
    tieBreakChainJson: nextTieBreakChainJson,
  });
  if (!candidate.ok) {
    return c.json({ error: 'rule_invalid', issues: candidate.issues }, 400);
  }

  const assignments: string[] = [];
  const values: unknown[] = [];
  if (patch.required_criteria !== undefined) {
    assignments.push('required_criteria = ?');
    values.push(nextRequiredCriteriaJson);
  }
  if (patch.points_preference !== undefined) {
    assignments.push('points_preference = ?');
    values.push(nextPointsPreferenceJson);
  }
  if (patch.tie_break_chain !== undefined) {
    assignments.push('tie_break_chain = ?');
    values.push(nextTieBreakChainJson);
  }
  if (patch.notes !== undefined) {
    assignments.push('notes = ?');
    values.push(patch.notes);
  }

  // D1 batches both changes: the child update only applies if the draft is at
  // the version we read, and the parent revision advances in the same batch.
  // This closes the publish/PATCH validation race without opening a window in
  // which a valid draft can mutate after it has been reviewed for publication.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE position_rules
            SET ${assignments.join(', ')}
          WHERE id = ?
            AND EXISTS (
              SELECT 1 FROM rule_books
               WHERE version = ? AND status = 'draft' AND revision = ?
            )`,
    ).bind(...values, id, existing.ruleBookVersion, book.revision),
    c.env.DB.prepare(
      `UPDATE rule_books
            SET revision = revision + 1
          WHERE version = ? AND status = 'draft' AND revision = ?`,
    ).bind(existing.ruleBookVersion, book.revision),
  ]);
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    const currentBook = await db
      .select()
      .from(ruleBooks)
      .where(eq(ruleBooks.version, existing.ruleBookVersion))
      .get();
    if (currentBook?.status !== 'draft') {
      return c.json(
        { error: 'rule_book_immutable', status: currentBook?.status ?? 'missing' },
        409,
      );
    }
    return c.json({ error: 'rule_book_changed' }, 409);
  }
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

// DELETE /api/admin/rules/:id
// Only a draft may be changed. This is intentionally a rule-book lifecycle
// action, rather than a direct D1 recipe, so a verified non-biddable position
// can be removed from a cloned draft without ever mutating the active book.
router.delete('/:id{\\d+}', requireStepUpAuth(), async (c) => {
  const id = Number(c.req.param('id'));
  const raw = await c.req.json().catch(() => null);
  const parsed = RuleDeleteSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;

  if (!isReasonValidForAction('override_rule', body.reason_code)) {
    return c.json({ error: 'invalid_reason_for_action', reason_code: body.reason_code }, 400);
  }

  const db = getDb(c.env.DB);
  const existing = await db.select().from(positionRules).where(eq(positionRules.id, id)).get();
  if (existing === undefined) return c.json({ error: 'not_found' }, 404);
  const book = await db
    .select()
    .from(ruleBooks)
    .where(eq(ruleBooks.version, existing.ruleBookVersion))
    .get();
  if (book === undefined) return c.json({ error: 'rule_book_missing' }, 500);
  if (book.status !== 'draft') {
    return c.json({ error: 'rule_book_immutable', status: book.status }, 409);
  }

  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM position_rules
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM rule_books
             WHERE version = ? AND status = 'draft' AND revision = ?
          )`,
    ).bind(id, existing.ruleBookVersion, book.revision),
    c.env.DB.prepare(
      `UPDATE rule_books
          SET revision = revision + 1
        WHERE version = ? AND status = 'draft' AND revision = ?`,
    ).bind(existing.ruleBookVersion, book.revision),
  ]);
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    const currentBook = await db
      .select()
      .from(ruleBooks)
      .where(eq(ruleBooks.version, existing.ruleBookVersion))
      .get();
    if (currentBook?.status !== 'draft') {
      return c.json(
        { error: 'rule_book_immutable', status: currentBook?.status ?? 'missing' },
        409,
      );
    }
    return c.json({ error: 'rule_book_changed' }, 409);
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'override_rule',
    targetKind: 'position_rule',
    targetId: String(id),
    reason: body.reason,
    beforeState: existing,
    afterState: {
      deleted: true,
      rule_book_version: existing.ruleBookVersion,
      position_id: existing.positionId,
    },
  });

  return c.json({
    deleted: true,
    id,
    rule_book_version: existing.ruleBookVersion,
    position_id: existing.positionId,
    revision: book.revision + 1,
  });
});

export default router;
