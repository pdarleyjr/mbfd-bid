import { zValidator } from '@hono/zod-validator';
import type { JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { bidSessions } from '../../db/schema.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const r = new Hono<AdminEnv>();
r.use('*', requireAdmin);

const IdemHeader = z.string().uuid();

function getDoStub(env: WorkerEnv, bidSessionId: string) {
  const id = env.BID_SESSION.idFromName(bidSessionId);
  return env.BID_SESSION.get(id);
}

/**
 * The legacy DO command endpoints do not write canonical command evidence.
 * Mock/rehearsal sessions therefore must use the rehearsal command boundary;
 * allowing a generic command through here would split the DO projection from
 * the D1-authoritative mock state before a route-level guard could intervene.
 */
async function mockSessionCommandRejection(
  env: WorkerEnv,
  bidSessionId: string,
): Promise<{ error: string; status: 404 | 409 | 503 } | null> {
  if (!env.DB) return { error: 'bid_session_lookup_unavailable', status: 503 };
  try {
    const session = await getDb(env.DB)
      .select({ isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, bidSessionId))
      .get();
    if (session === undefined) return { error: 'session_not_found', status: 404 };
    if (session.isMock) return { error: 'mock_session_requires_rehearsal_command', status: 409 };
    return null;
  } catch {
    return { error: 'bid_session_lookup_unavailable', status: 503 };
  }
}

const SkipBody = z.object({
  bidSessionId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

r.post('/skip', requireStepUpAuth(), zValidator('json', SkipBody), async (c) => {
  const idem = IdemHeader.safeParse(c.req.header('Idempotency-Key'));
  if (!idem.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = c.req.valid('json');
  const guard = await mockSessionCommandRejection(c.env, body.bidSessionId);
  if (guard !== null) return c.json({ error: guard.error }, guard.status);
  const stub = getDoStub(c.env, body.bidSessionId);
  const res = await stub.fetch('https://do/admin/skip', {
    method: 'POST',
    body: JSON.stringify({ adminActorId: c.get('claims').member_id, reason: body.reason }),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  return c.json(payload, res.status as 200 | 409);
});

const OverrideBody = z.object({
  bidSessionId: z.string().min(1),
  targetMemberId: z.number().int().positive(),
  positionId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

r.post('/override', requireStepUpAuth(), zValidator('json', OverrideBody), async (c) => {
  const idem = IdemHeader.safeParse(c.req.header('Idempotency-Key'));
  if (!idem.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = c.req.valid('json');
  const guard = await mockSessionCommandRejection(c.env, body.bidSessionId);
  if (guard !== null) return c.json({ error: guard.error }, guard.status);
  const stub = getDoStub(c.env, body.bidSessionId);
  const res = await stub.fetch('https://do/admin/force-pick', {
    method: 'POST',
    body: JSON.stringify({
      adminActorId: c.get('claims').member_id,
      targetMemberId: body.targetMemberId,
      positionId: body.positionId,
      reason: body.reason,
    }),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  return c.json(payload, res.status as 200 | 409);
});

const FreezeBody = z.object({
  bidSessionId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

r.post('/freeze', requireStepUpAuth(), zValidator('json', FreezeBody), async (c) => {
  const idem = IdemHeader.safeParse(c.req.header('Idempotency-Key'));
  if (!idem.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = c.req.valid('json');
  const guard = await mockSessionCommandRejection(c.env, body.bidSessionId);
  if (guard !== null) return c.json({ error: guard.error }, guard.status);
  const stub = getDoStub(c.env, body.bidSessionId);
  const res = await stub.fetch('https://do/admin/freeze', {
    method: 'POST',
    body: JSON.stringify({ adminActorId: c.get('claims').member_id, reason: body.reason }),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  return c.json(payload, res.status as 200 | 409);
});

export default r;
