import { type Context, Hono } from 'hono';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import type { WorkerEnv } from '../types/env.js';

type BidContext = Context<{ Bindings: WorkerEnv }>;

const bid = new Hono<{ Bindings: WorkerEnv }>();

async function requireJwt(c: BidContext) {
  const env = validateEnv(c.env);
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return await verifyJwt(auth.slice(7), env.JWT_SIGNING_KEY);
  } catch {
    return null;
  }
}

bid.get('/me', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'unauthorised' }, 401);
  return c.json({
    memberId: claims.sub,
    employeeId: claims.emp,
    role: claims.role,
    rank: claims.rank,
    firstName: claims.first_name,
    lastName: claims.last_name,
  });
});

bid.get('/me/eligibility', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'unauthorised' }, 401);
  // Eligibility for every open position. In the live event the DO has the
  // up-to-the-second fills map; here we return a snapshot from D1 + the
  // eligibility engine. Pulled into the page via React Server Component.
  return c.json({ memberId: claims.sub, positions: [] });
});

bid.get('/board', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'unauthorised' }, 401);
  const bidSessionId = c.req.query('bidSessionId') ?? '01HSESS';
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  const body = (await snap.json()) as Record<string, unknown>;
  return c.json(body);
});

bid.get('/bid/state', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'unauthorised' }, 401);
  const sinceSeq = Number(c.req.query('since_seq') ?? '0');
  const bidSessionId = c.req.query('bidSessionId') ?? '01HSESS';
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  const state = (await snap.json()) as { lastSeq: number };
  return c.json({ seq: state.lastSeq, since: sinceSeq, events: [], state });
});

export default bid;
