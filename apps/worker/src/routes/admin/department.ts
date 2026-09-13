import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { isCalendarDate, loadDepartmentRosterProjection } from '../../lib/department-roster.js';
import { operationalDate } from '../../lib/operational-date.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);

/** Year-round Department truth. No annual Bid policy or execution side effects. */
router.get('/current-roster', async (c) => {
  const asOf = c.req.query('as_of') ?? operationalDate();
  if (!isCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  const result = await loadDepartmentRosterProjection(
    c.env.DB,
    asOf,
    ['shift', 'station', 'division', 'unit', 'rank'].map((name) => ({
      name,
      value: c.req.query(name),
    })),
  );
  if (!result.ok) return c.json({ error: result.error }, 400);
  c.header('Cache-Control', 'no-store');
  return c.json(result.projection);
});

export default router;
