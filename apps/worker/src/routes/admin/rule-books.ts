import { zValidator } from '@hono/zod-validator';
import { CreateRuleBookSchema, type JwtPayload, PublishRuleBookSchema } from '@mbfd/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { positionRules, ruleBooks } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { nextVersion } from '../../lib/rule-book-version.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

// GET /api/admin/rule-books
router.get('/', async (c) => {
  const year = c.req.query('effective_year');
  const db = getDb(c.env.DB);
  const rows = year
    ? await db
        .select()
        .from(ruleBooks)
        .where(eq(ruleBooks.effectiveYear, Number(year)))
        .orderBy(desc(ruleBooks.effectiveYear), desc(ruleBooks.version))
        .all()
    : await db
        .select()
        .from(ruleBooks)
        .orderBy(desc(ruleBooks.effectiveYear), desc(ruleBooks.version))
        .all();
  return c.json({ rule_books: rows });
});

// POST /api/admin/rule-books   (step-up; creates draft, optionally clones)
router.post('/', requireStepUpAuth(), zValidator('json', CreateRuleBookSchema), async (c) => {
  const { effective_year, clone_from, notes } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const allVersions = await db.select({ v: ruleBooks.version }).from(ruleBooks).all();
  const newVersion = nextVersion(
    effective_year,
    allVersions.map((r) => r.v),
  );

  if (clone_from !== undefined) {
    const src = await db.select().from(ruleBooks).where(eq(ruleBooks.version, clone_from)).get();
    if (src === undefined) {
      return c.json({ error: 'clone_from_not_found', clone_from }, 400);
    }
  }

  // Insert draft + (optional) clone rules.
  await db.insert(ruleBooks).values({
    version: newVersion,
    effectiveYear: effective_year,
    notes: notes ?? null,
    status: 'draft',
  });

  if (clone_from !== undefined) {
    const sourceRules = await db
      .select()
      .from(positionRules)
      .where(eq(positionRules.ruleBookVersion, clone_from))
      .all();
    for (const row of sourceRules) {
      await db.insert(positionRules).values({
        ruleBookVersion: newVersion,
        positionId: row.positionId,
        templateVersion: row.templateVersion,
        requiredCriteriaJson: row.requiredCriteriaJson,
        pointsPreferenceJson: row.pointsPreferenceJson,
        tieBreakChainJson: row.tieBreakChainJson,
        notes: row.notes,
      });
    }
  }

  return c.json({ version: newVersion, status: 'draft' }, 201);
});

// POST /api/admin/rule-books/:version/publish   (step-up; atomic swap)
router.post(
  '/:version/publish',
  requireStepUpAuth(),
  zValidator('json', PublishRuleBookSchema),
  async (c) => {
    const version = c.req.param('version');
    const { reason } = c.req.valid('json');
    const db = getDb(c.env.DB);

    const target = await db.select().from(ruleBooks).where(eq(ruleBooks.version, version)).get();
    if (target === undefined) return c.json({ error: 'not_found' }, 404);
    if (target.status === 'active') return c.json({ error: 'already_active' }, 409);
    if (target.status === 'archived') return c.json({ error: 'archived_cannot_republish' }, 409);

    const claims = c.get('claims');
    const actorId = claims.sub > 0 ? claims.sub : null;

    // D1 lacks BEGIN/COMMIT but supports batch — use db.batch for atomicity.
    const now = new Date();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE rule_books SET status = 'archived' WHERE effective_year = ? AND status = 'active'`,
      ).bind(target.effectiveYear),
      c.env.DB.prepare(
        `UPDATE rule_books SET status = 'active', published_at = ?, published_by = ? WHERE version = ?`,
      ).bind(now.getTime(), actorId, version),
    ]);

    await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'admin',
      actorId,
      action: 'rule_book_clone', // existing enum value; covers publish
      targetKind: 'rule_book',
      targetId: version,
      reason,
      afterState: { effective_year: target.effectiveYear, status: 'active' },
    });

    return c.json({ version, status: 'active', published_at: now.toISOString() });
  },
);

export default router;
