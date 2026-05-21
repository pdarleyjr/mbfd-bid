import {
  type ADayState,
  COMBAT_GROUPS,
  type Member,
  WEEKDAYS,
  canPick,
  computeAllMeters,
} from '@mbfd/a-day';
import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import { SubmitADayPickRequestSchema } from '@mbfd/shared';
import { desc, eq, inArray, ne } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { getDb } from '../db/index.js';
import {
  bidSessions as bidSessionsTable,
  bids as bidsTable,
  credentials,
  memberCredentials,
  members as membersTable,
  positionRules,
  ruleBooks,
} from '../db/schema.js';
import { hydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState, PersistedADayState } from '../durable/bid-session-state.js';
import { chunkedInArraySelect } from '../lib/d1-batch.js';
import { validateEnv } from '../lib/env.js';
import { verifyJwt } from '../lib/jwt.js';
import { computeOnDeck } from '../lib/on-deck.js';
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

function readSessionQuery(c: BidContext): string | undefined {
  return c.req.query('bidSessionId') ?? c.req.query('session') ?? c.req.query('session_id');
}

async function resolveBidSessionId(
  c: BidContext,
  explicitSessionId: string | undefined,
): Promise<string | null> {
  if (explicitSessionId && explicitSessionId.trim().length > 0) return explicitSessionId;
  const db = getDb(c.env.DB);
  const session = await db
    .select({ id: bidSessionsTable.id })
    .from(bidSessionsTable)
    .where(ne(bidSessionsTable.currentPhase, 'complete'))
    .orderBy(desc(bidSessionsTable.startedAt))
    .get();
  return session?.id ?? null;
}

async function loadActiveRuleBookVersion(c: BidContext): Promise<string | null> {
  const db = getDb(c.env.DB);
  const active = await db
    .select({ version: ruleBooks.version })
    .from(ruleBooks)
    .where(eq(ruleBooks.status, 'active'))
    .get();
  return active?.version ?? null;
}

function parsePositionRule(row: typeof positionRules.$inferSelect): PositionRule {
  return {
    positionId: row.positionId,
    ruleBookVersion: row.ruleBookVersion,
    requiredCriteria: JSON.parse(row.requiredCriteriaJson),
    pointsPreference: JSON.parse(row.pointsPreferenceJson),
    tieBreakChain: JSON.parse(row.tieBreakChainJson),
  };
}

bid.get('/me', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
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
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const db = getDb(c.env.DB);
  const member = await db.select().from(membersTable).where(eq(membersTable.id, claims.sub)).get();
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

  const version = c.req.query('rule_book_version') ?? (await loadActiveRuleBookVersion(c));
  if (!version) return c.json({ error: 'no_active_rule_book' }, 404);

  const memberCreds = await db
    .select({ name: credentials.name })
    .from(memberCredentials)
    .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(memberCredentials.memberId, claims.sub))
    .all();

  const rules = await db
    .select()
    .from(positionRules)
    .where(eq(positionRules.ruleBookVersion, version))
    .all();

  const sessionId = await resolveBidSessionId(c, readSessionQuery(c));
  const filled = new Set<string>();
  if (sessionId) {
    const rows = await db
      .select({ positionId: bidsTable.positionId })
      .from(bidsTable)
      .where(eq(bidsTable.bidSessionId, sessionId))
      .all();
    for (const row of rows) filled.add(row.positionId);
  }

  const eligibilityMember = {
    employeeId: member.employeeId,
    firstName: member.firstName,
    lastName: member.lastName,
    rank: member.rank,
    rscSeniority: member.rscSeniority,
    rankSeniority: member.rankSeniority ?? undefined,
    isProbationary: member.isProbationary,
    credentials: memberCreds.map((cred) => ({ name: cred.name })),
  };

  const positions = rules
    .filter((rule) => !filled.has(rule.positionId))
    .map((rule) => {
      const parsedRule = parsePositionRule(rule);
      const result = evaluateEligibility(eligibilityMember, parsedRule);
      return {
        positionId: rule.positionId,
        eligible: result.eligible,
        reasons: result.reasons,
        points: result.points,
      };
    });

  return c.json({ memberId: claims.sub, positions });
});

interface BidderContext {
  memberId: number;
  ordinal: number;
  pool: 'OFC' | 'FF';
  firstName: string;
  lastName: string;
  rank: string;
  employeeId: string;
}

bid.get('/board', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const bidSessionId = await resolveBidSessionId(c, readSessionQuery(c));
  if (!bidSessionId) return c.json({ error: 'no_active_session' }, 404);
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  const body = (await snap.json()) as Record<string, unknown> & {
    bidOrder?: ReadonlyArray<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }>;
    currentBidderId?: number | null;
    fills?: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  };

  // Plan 09 / Rehearsal Tooling — surface `is_mock` so the page can render
  // MockBanner without a second round-trip. Failure to read the session row
  // (e.g. local dev without seeded data) leaves `is_mock=false` — the live
  // banner only appears when the column explicitly says so.
  let isMock = false;
  try {
    const db = getDb(c.env.DB);
    const session = await db
      .select({ isMock: bidSessionsTable.isMock })
      .from(bidSessionsTable)
      .where(eq(bidSessionsTable.id, bidSessionId))
      .get();
    isMock = session?.isMock === true;
  } catch {
    // best-effort — banner stays off if the lookup fails
  }

  // Live Bid Console enrichment — hydrate the active bidder + next-5 queue
  // with member context so the UI shows "CPT Sola (14335)" instead of just
  // "ID 14335". Best-effort: if D1 lookup fails the legacy id-only payload
  // still ships and the front-end renders the fallback.
  let currentBidder: BidderContext | null = null;
  let onDeck: BidderContext[] = [];
  try {
    const bidOrder = Array.isArray(body.bidOrder) ? body.bidOrder : [];
    const currentBidderId = typeof body.currentBidderId === 'number' ? body.currentBidderId : null;
    const fillsRec = body.fills && typeof body.fills === 'object' ? body.fills : {};
    const filledMemberIds = new Set<number>(Object.values(fillsRec).map((f) => f.memberId));
    const onDeckEntries = computeOnDeck(bidOrder, currentBidderId, filledMemberIds);
    const lookupIds = new Set<number>();
    if (currentBidderId !== null) lookupIds.add(currentBidderId);
    for (const e of onDeckEntries) lookupIds.add(e.memberId);
    if (lookupIds.size > 0) {
      const db = getDb(c.env.DB);
      const rows = await chunkedInArraySelect(Array.from(lookupIds), (chunk) =>
        db
          .select({
            id: membersTable.id,
            employeeId: membersTable.employeeId,
            firstName: membersTable.firstName,
            lastName: membersTable.lastName,
            rank: membersTable.rank,
          })
          .from(membersTable)
          .where(inArray(membersTable.id, chunk))
          .all(),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      const bidOrderIndex = new Map(bidOrder.map((e) => [e.memberId, e]));
      if (currentBidderId !== null) {
        const row = byId.get(currentBidderId);
        const order = bidOrderIndex.get(currentBidderId);
        if (row && order) {
          currentBidder = {
            memberId: row.id,
            ordinal: order.ordinal,
            pool: order.pool,
            firstName: row.firstName,
            lastName: row.lastName,
            rank: row.rank,
            employeeId: row.employeeId,
          };
        }
      }
      onDeck = onDeckEntries.flatMap((entry) => {
        const row = byId.get(entry.memberId);
        if (!row) return [];
        return [
          {
            memberId: row.id,
            ordinal: entry.ordinal,
            pool: entry.pool,
            firstName: row.firstName,
            lastName: row.lastName,
            rank: row.rank,
            employeeId: row.employeeId,
          },
        ];
      });
    }
  } catch (err) {
    console.error('[bid.board] enrichment failed (fail-soft)', err);
  }

  return c.json({ ...body, isMock, bidSessionId, currentBidder, onDeck });
});

bid.get('/bid/state', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const sinceSeq = Number(c.req.query('since_seq') ?? '0');
  const bidSessionId = await resolveBidSessionId(c, readSessionQuery(c));
  if (!bidSessionId) return c.json({ error: 'no_active_session' }, 404);
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
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
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
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
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
