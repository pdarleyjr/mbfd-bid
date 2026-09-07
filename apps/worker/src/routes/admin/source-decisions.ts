import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { isQualificationCalendarDate } from '../../lib/qualification-lifecycle.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.get('/:year', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  c.header('Cache-Control', 'private, no-store');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM bid_source_decisions WHERE bid_year=? ORDER BY issue_id,revision DESC',
  )
    .bind(year)
    .all();
  const documents = await c.env.DB.prepare(
    'SELECT id,rule_book_version,revision,status,policy_text FROM annual_bid_policy_documents WHERE effective_year=? ORDER BY rule_book_version,revision DESC',
  )
    .bind(year)
    .all();
  return c.json({ year, history: rows.results, documents: documents.results });
});
router.post('/:year', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const input = z
    .object({
      issue_id: z.string().regex(/^[a-z0-9-]{1,80}$/),
      expected_revision: z.number().int().nonnegative(),
      title: z.string().trim().min(4).max(200),
      question: z.string().trim().min(4).max(3000),
      area: z.enum(['positions', 'rules', 'annual-policy', 'annual-plan']),
      status: z.enum(['OPEN', 'RESOLVED']),
      decision: z.string().trim().min(4).max(4000),
      source_ref: z.string().trim().min(4).max(1000),
      effective_on: z.string().refine(isQualificationCalendarDate),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'complete_source_decision_required' }, 400);
  const b = input.data;
  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO bid_source_decisions SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM bid_source_decisions WHERE bid_year=? AND issue_id=?),0)=?',
    )
      .bind(
        year,
        b.issue_id,
        b.expected_revision + 1,
        b.title,
        b.question,
        b.area,
        b.status,
        b.decision,
        b.source_ref,
        b.effective_on,
        String(c.get('claims').sub),
        Date.now(),
        year,
        b.issue_id,
        b.expected_revision,
      )
      .run();
    if (result.meta.changes !== 1)
      return c.json({ error: 'source_decision_changed_refresh_before_saving' }, 409);
  } catch {
    return c.json({ error: 'source_decision_changed_refresh_before_saving' }, 409);
  }
  return c.json({
    saved: true,
    revision: b.expected_revision + 1,
    notice:
      'Decision recorded. Apply any resulting rule or staffing edits, then refresh impact review and practice. Existing approved bid evidence is unchanged.',
  });
});
export default router;
