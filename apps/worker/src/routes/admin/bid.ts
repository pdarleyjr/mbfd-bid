import { zValidator } from '@hono/zod-validator';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
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

const SkipBody = z.object({
  bidSessionId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

r.post('/skip', zValidator('json', SkipBody), async (c) => {
  const idem = IdemHeader.safeParse(c.req.header('Idempotency-Key'));
  if (!idem.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = c.req.valid('json');
  const stub = getDoStub(c.env, body.bidSessionId);
  const res = await stub.fetch('https://do/admin/skip', {
    method: 'POST',
    body: JSON.stringify({ adminActorId: c.get('claims').sub, reason: body.reason }),
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

r.post('/override', zValidator('json', OverrideBody), async (c) => {
  const idem = IdemHeader.safeParse(c.req.header('Idempotency-Key'));
  if (!idem.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = c.req.valid('json');
  const stub = getDoStub(c.env, body.bidSessionId);
  const res = await stub.fetch('https://do/admin/force-pick', {
    method: 'POST',
    body: JSON.stringify({
      adminActorId: c.get('claims').sub,
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

r.post('/freeze', zValidator('json', FreezeBody), async (c) => {
  const idem = IdemHeader.safeParse(c.req.header('Idempotency-Key'));
  if (!idem.success) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = c.req.valid('json');
  const stub = getDoStub(c.env, body.bidSessionId);
  const res = await stub.fetch('https://do/admin/freeze', {
    method: 'POST',
    body: JSON.stringify({ adminActorId: c.get('claims').sub, reason: body.reason }),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  return c.json(payload, res.status as 200 | 409);
});

export default r;
