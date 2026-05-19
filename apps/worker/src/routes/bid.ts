import {
  type ADayState,
  COMBAT_GROUPS,
  type Member,
  WEEKDAYS,
  canPick,
  computeAllMeters,
} from '@mbfd/a-day';
import { SubmitADayPickRequestSchema } from '@mbfd/shared';
import { type Context, Hono } from 'hono';
import { getDb } from '../db/index.js';
import { members as membersTable } from '../db/schema.js';
import { hydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState, PersistedADayState } from '../durable/bid-session-state.js';
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

// ---------- Plan 07 Phase 2 (A-Day) REST routes ----------

/**
 * Load the full member roster from D1. The DO state holds A-Day picks but not
 * member rank/name detail, so we hydrate from the database for invariant
 * lookups and meter calculation. Returns Member objects shaped for @mbfd/a-day.
 */
async function loadMembersForADay(c: BidContext): Promise<Member[]> {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(membersTable);
  return rows.map(
    (m): Member => ({
      employeeId: String(m.id),
      firstName: m.firstName,
      lastName: m.lastName,
      rank: m.rank,
      rscSeniority: m.rscSeniority,
      rankSeniority: m.rankSeniority ?? undefined,
      isProbationary: m.isProbationary,
      credentials: [],
    }),
  );
}

async function fetchSessionSnapshot(
  c: BidContext,
  bidSessionId: string,
): Promise<BidSessionState | null> {
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  if (!snap.ok) return null;
  return (await snap.json()) as BidSessionState;
}

/**
 * GET /api/bid/a-day-state?session=:id
 * Returns the snapshot needed to render the Phase 2 picker:
 *  - current phase
 *  - whether it is the calling member's turn
 *  - eligible A-Day candidates for that member (subject to canPick)
 *  - capacity meters for all 12 groups + 7 weekdays
 */
bid.get('/bid/a-day-state', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'unauthorised' }, 401);
  const sessionId = c.req.query('session');
  if (!sessionId) return c.json({ error: 'session_required' }, 400);

  const snapshot = await fetchSessionSnapshot(c, sessionId);
  if (!snapshot) return c.json({ error: 'session_not_found' }, 404);

  if (snapshot.currentPhase !== 'a_day_bid' || !snapshot.aDay) {
    return c.json({
      currentPhase: snapshot.currentPhase,
      isMyTurn: false,
      shift: null,
      eligibleADays: [],
      meters: { groups: [], weekdays: [] },
    });
  }

  const memberId = Number(claims.sub);
  const members = await loadMembersForADay(c);
  const membersById = new Map<number, Member>(members.map((m) => [Number(m.employeeId), m]));
  const aDayState: ADayState = hydrateADayState(snapshot.aDay, membersById);
  const phase1 = aDayState.phase1ByMember.get(memberId);
  const isMyTurn = snapshot.currentBidderId === memberId;
  const candidates: readonly string[] = phase1?.shift === 'D' ? WEEKDAYS : COMBAT_GROUPS;
  const eligibleADays = candidates.filter((aDay) => canPick(aDayState, memberId, aDay as never).ok);
  return c.json({
    currentPhase: snapshot.currentPhase,
    isMyTurn,
    shift: phase1?.shift ?? null,
    eligibleADays,
    meters: computeAllMeters(aDayState),
  });
});

/**
 * POST /api/bid/a-day-pick
 * REST fallback for non-WS clients. Forwards to the DO's submitADayPick handler.
 */
bid.post('/bid/a-day-pick', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'unauthorised' }, 401);
  const raw = await c.req.json().catch(() => null);
  const parsed = SubmitADayPickRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_payload', issues: parsed.error.issues }, 400);
  }
  const memberId = Number(claims.sub);
  const snapshot = await fetchSessionSnapshot(c, parsed.data.bidSessionId);
  if (!snapshot) return c.json({ error: 'session_not_found' }, 404);
  if (snapshot.currentPhase !== 'a_day_bid' || !snapshot.aDay) {
    return c.json(
      {
        type: 'a_day_reject',
        v: 1,
        memberId,
        reasonCode: 'PHASE_NOT_A_DAY_BID',
        reasonLabel: `Phase 2 is not active (phase=${snapshot.currentPhase}).`,
      },
      403,
    );
  }
  if (snapshot.currentBidderId !== memberId) {
    return c.json(
      {
        type: 'a_day_reject',
        v: 1,
        memberId,
        reasonCode: 'NOT_YOUR_TURN',
        reasonLabel: 'It is not your turn to pick.',
      },
      403,
    );
  }

  const members = await loadMembersForADay(c);
  const doId = c.env.BID_SESSION.idFromName(parsed.data.bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const doResp = await stub.fetch(`${new URL(c.req.url).origin}/submit-a-day-pick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      senderMemberId: memberId,
      aDay: parsed.data.aDay,
      idempotencyKey: parsed.data.idempotencyKey,
      members,
    }),
  });
  const json = (await doResp.json()) as { kind: string; code?: string };
  if (json.kind === 'rejected') {
    if (json.code === 'NOT_YOUR_TURN' || json.code === 'PHASE_NOT_A_DAY_BID') {
      return c.json(json, 403);
    }
    return c.json(json, 409);
  }
  return c.json(json, 200);
});

// Re-export the inferred persisted shape for tests.
export type { BidSessionState, PersistedADayState };

export default bid;
