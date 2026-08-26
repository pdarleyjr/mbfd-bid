import { zValidator } from '@hono/zod-validator';
import { CreateRuleBookSchema, type JwtPayload, PublishRuleBookSchema } from '@mbfd/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { positionRules, ruleBooks } from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { decodeRuleBookRows } from '../../lib/position-rule.js';
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

  // A predicted draft version must never be externally visible with only a
  // partial clone: a concurrent publisher could otherwise validate a prefix
  // of the source book, activate it, and let this request append more rows to
  // that active book. D1 executes this batch as one transaction.
  const insertRuleBook = c.env.DB.prepare(
    `INSERT INTO rule_books (version, effective_year, notes, status)
       VALUES (?, ?, ?, 'draft')`,
  ).bind(newVersion, effective_year, notes ?? null);
  if (clone_from === undefined) {
    await insertRuleBook.run();
  } else {
    await c.env.DB.batch([
      insertRuleBook,
      c.env.DB.prepare(
        `INSERT INTO position_rules (
             rule_book_version,
             position_id,
             template_version,
             required_criteria,
             points_preference,
             tie_break_chain,
             notes
           )
           SELECT ?, position_id, template_version, required_criteria,
                  points_preference, tie_break_chain, notes
             FROM position_rules
            WHERE rule_book_version = ?`,
      ).bind(newVersion, clone_from),
    ]);
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

    const candidateRules = await db
      .select()
      .from(positionRules)
      .where(eq(positionRules.ruleBookVersion, version))
      .all();
    const decodedRuleBook = decodeRuleBookRows(candidateRules);
    if (
      candidateRules.length === 0 ||
      decodedRuleBook.invalidPositionIds.length > 0 ||
      decodedRuleBook.duplicatePositionIds.length > 0
    ) {
      return c.json(
        {
          error: 'rule_book_invalid',
          empty_rule_book: candidateRules.length === 0,
          invalid_position_ids: decodedRuleBook.invalidPositionIds,
          duplicate_position_ids: decodedRuleBook.duplicatePositionIds,
        },
        409,
      );
    }

    const claims = c.get('claims');
    const actorId = claims.sub > 0 ? claims.sub : null;

    // D1 batches the state transition.  The archive is conditioned on the
    // exact draft revision that was validated above; if a PATCH wins the race,
    // neither statement changes the active policy.  Separating archive and
    // promotion also avoids depending on SQLite's row-update order around the
    // partial one-active-book unique index.
    const currentActive = await db
      .select({ version: ruleBooks.version })
      .from(ruleBooks)
      .where(and(eq(ruleBooks.effectiveYear, target.effectiveYear), eq(ruleBooks.status, 'active')))
      .get();
    const now = new Date();
    const statements: D1PreparedStatement[] = [];
    if (currentActive !== undefined) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE rule_books
               SET status = 'archived'
             WHERE version = ?
               AND effective_year = ?
               AND status = 'active'
               AND EXISTS (
                 SELECT 1 FROM rule_books
                  WHERE version = ? AND status = 'draft' AND revision = ?
               )`,
        ).bind(currentActive.version, target.effectiveYear, version, target.revision),
      );
    }
    statements.push(
      c.env.DB.prepare(
        `UPDATE rule_books
             SET status = 'active', published_at = ?, published_by = ?
           WHERE version = ?
             AND status = 'draft'
             AND revision = ?
             AND NOT EXISTS (
               SELECT 1 FROM rule_books
                WHERE effective_year = ? AND status = 'active'
             )`,
      ).bind(now.getTime(), actorId, version, target.revision, target.effectiveYear),
    );
    const results = await c.env.DB.batch(statements);
    const publishResult = results[results.length - 1];
    if (publishResult?.meta.changes !== 1) {
      return c.json({ error: 'rule_book_status_changed' }, 409);
    }

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
