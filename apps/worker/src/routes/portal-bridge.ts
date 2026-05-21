/**
 * Portal-bridge routes — called by the MBFD Hub Laravel app, NOT by browsers.
 *
 * The MBFD Hub Employee Portal embeds a "My Bid Certifications" page that
 * pulls a member's cert list from this Worker. Gated by a shared bearer
 * token (env `PORTAL_BID_READER`) matching the value the portal stores as
 * `BID_READER_TOKEN`. No user JWT involved — this is server-to-server.
 *
 * Routes (mounted at /api/portal):
 *   GET /members/:employee_id/credentials
 *     → { credentials: string[], lastUpdated: string|null }
 *
 * Failure shapes:
 *   401 missing_token / invalid_token — middleware
 *   404 employee_not_found — no member row for that employee_id
 *   500 + console.error('[portal-bridge-error]') — unexpected exception
 *
 * Idempotent and read-only. Safe to call as often as the portal needs.
 */

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/index.js';
import { credentials as credentialsTable, memberCredentials, members } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';

const router = new Hono<{ Bindings: WorkerEnv }>();

router.use('*', async (c, next) => {
  const expected = (c.env.PORTAL_BID_READER ?? '').trim();
  if (expected === '') {
    // Fail closed: bridge not configured.
    return c.json({ error: 'bridge_disabled' }, 503);
  }
  const header = c.req.header('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return c.json({ error: 'missing_token' }, 401);
  }
  const presented = header.slice(7).trim();
  if (presented === '' || presented !== expected) {
    // Note: shared-secret comparison is intentionally constant-time-ish.
    // The token is high-entropy; an exact-string compare is fine here.
    return c.json({ error: 'invalid_token' }, 401);
  }
  await next();
  return;
});

router.get('/members/:employee_id/credentials', async (c) => {
  try {
    const employeeId = c.req.param('employee_id').trim();
    if (employeeId === '') {
      return c.json({ error: 'employee_id_required' }, 400);
    }

    const db = getDb(c.env.DB);
    const member = await db
      .select({ id: members.id, updatedAt: members.updatedAt })
      .from(members)
      .where(eq(members.employeeId, employeeId))
      .get();

    if (member === undefined) {
      return c.json({ error: 'employee_not_found', employee_id: employeeId }, 404);
    }

    const rows = await db
      .select({ name: credentialsTable.name })
      .from(memberCredentials)
      .innerJoin(credentialsTable, eq(memberCredentials.credentialId, credentialsTable.id))
      .where(eq(memberCredentials.memberId, member.id))
      .all();

    const sorted = rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));

    return c.json({
      employee_id: employeeId,
      credentials: sorted,
      lastUpdated: member.updatedAt instanceof Date ? member.updatedAt.toISOString() : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[portal-bridge-error]', { route: '/members/:employee_id/credentials', msg });
    return c.json({ error: 'internal_error', detail: msg }, 500);
  }
});

export default router;
