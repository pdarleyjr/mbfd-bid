import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
const validKey = (key: string) =>
  /^(annual-policy|annual-profiles|annual-start|qualification):[0-9]{1,8}$/.test(key);
router.get('/:key', async (c) => {
  const key = c.req.param('key');
  if (!validKey(key)) return c.json({ error: 'invalid_draft_key' }, 400);
  const draft = await c.env.DB.prepare(
    'SELECT revision,content_json,updated_at FROM admin_working_drafts WHERE actor_subject=? AND draft_key=?',
  )
    .bind(String(c.get('claims').sub), key)
    .first<{ revision: number; content_json: string; updated_at: number }>();
  return c.json({
    revision: draft?.revision ?? 0,
    content: draft ? JSON.parse(draft.content_json) : null,
    updatedAt: draft?.updated_at ?? null,
  });
});
// Saving private editor work needs an authenticated admin, not a fresh bid-operation approval.
router.post('/:key', async (c) => {
  const key = c.req.param('key');
  if (!validKey(key)) return c.json({ error: 'invalid_draft_key' }, 400);
  const input = z
    .object({
      expected_revision: z.number().int().nonnegative(),
      content: z.record(z.unknown()).nullable(),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_draft' }, 400);
  const content = JSON.stringify(input.data.content);
  if (content.length > 500000) return c.json({ error: 'draft_too_large' }, 413);
  const actor = String(c.get('claims').sub);
  const rev = input.data.expected_revision;
  const result =
    await c.env.DB.prepare(`INSERT INTO admin_working_drafts(actor_subject,draft_key,revision,content_json,updated_at)
    SELECT ?,?,1,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM admin_working_drafts WHERE actor_subject=? AND draft_key=?)
    ON CONFLICT(actor_subject,draft_key) DO UPDATE SET revision=admin_working_drafts.revision+1,content_json=excluded.content_json,updated_at=excluded.updated_at WHERE admin_working_drafts.revision=?`)
      .bind(actor, key, content, Date.now(), rev, actor, key, rev)
      .run();
  if (result.meta.changes !== 1)
    return c.json({ error: 'draft_changed_in_another_window_reload_before_saving' }, 409);
  return c.json({ revision: rev + 1 });
});
export default router;
