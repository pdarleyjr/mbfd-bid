import {
  type ADayState,
  COMBAT_GROUPS,
  type Member,
  WEEKDAYS,
  canPick,
  computeAllMeters,
} from '@mbfd/a-day';
import { evaluateEligibility } from '@mbfd/eligibility';
import { SubmitADayPickRequestSchema } from '@mbfd/shared';
import { desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import { bidSessions as bidSessionsTable, bids as bidsTable } from '../db/schema.js';
import { hydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState, PersistedADayState } from '../durable/bid-session-state.js';
import { computeBidOrder } from '../lib/bid-order.js';
import {
  bidOrderInputFromSnapshot,
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
} from '../lib/bid-policy.js';
import { mergeFills, resolveCurrentBidderId, resolvePhase } from '../lib/board-merge.js';
import { validateEnv } from '../lib/env.js';
import { refreshFederatedSession } from '../lib/federated-session.js';
import { verifyJwt } from '../lib/jwt.js';
import { computeFrozenStageOrder } from '../lib/live-bid-policy.js';
import { withLocalMemberIdentity } from '../lib/local-member-identity.js';
import { computeOnDeck } from '../lib/on-deck.js';
import type { TransitionRosterEntry } from '../lib/post-bid-transition.js';
import type { WorkerEnv } from '../types/env.js';

type BidContext = Context<{ Bindings: WorkerEnv }>;

const bid = new Hono<{ Bindings: WorkerEnv }>();

/** Safe member reads may reuse the bounded role-specific Hub authorization window. */
export function shouldForceBidRevalidation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

async function requireJwt(c: BidContext) {
  const env = validateEnv(c.env);
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const claims = await verifyJwt(auth.slice(7), env.JWT_SIGNING_KEY);
    const refreshed = await refreshFederatedSession(
      claims,
      env,
      Math.floor(Date.now() / 1000),
      shouldForceBidRevalidation(c.req.method),
    );
    if (!refreshed.ok) return null;
    if (refreshed.jwt !== null) c.header('X-MBFD-Session-Refresh', refreshed.jwt);
    return await withLocalMemberIdentity(c.env.DB, refreshed.claims);
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
  const sessions = await db
    .select({ id: bidSessionsTable.id, currentPhase: bidSessionsTable.currentPhase })
    .from(bidSessionsTable)
    .orderBy(desc(bidSessionsTable.startedAt))
    .all();
  for (const session of sessions) {
    const canonical = await loadCanonicalBidSessionState(c.env.DB, session.id);
    if ((canonical?.currentPhase ?? session.currentPhase) !== 'complete') return session.id;
  }
  return null;
}

function orderMatchesFrozenSnapshot(
  persisted: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
  expected: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
): boolean {
  return (
    persisted.length === expected.length &&
    persisted.every((entry, index) => {
      const candidate = expected[index];
      return (
        candidate !== undefined &&
        entry.ordinal === candidate.ordinal &&
        entry.memberId === candidate.memberId &&
        entry.pool === candidate.pool
      );
    })
  );
}

/**
 * Canonical live commands may reorder the remaining bidders or consume an
 * interrupting-specialty candidate.  The read model still requires every
 * surviving entry to be one unique member of the immutable frozen order with
 * its original ordinal and pool metadata unchanged.
 */
export function canonicalOrderUsesFrozenMembership(
  persisted: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
  expected: readonly { ordinal: number; memberId: number; pool: 'OFC' | 'FF' }[],
): boolean {
  if (new Set(persisted.map((entry) => entry.memberId)).size !== persisted.length) return false;
  const expectedByMember = new Map(expected.map((entry) => [entry.memberId, entry]));
  return persisted.every((entry) => {
    const frozen = expectedByMember.get(entry.memberId);
    return frozen !== undefined && frozen.ordinal === entry.ordinal && frozen.pool === entry.pool;
  });
}

bid.get('/me', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  return c.json({
    memberId: claims.member_id,
    employeeId: claims.emp,
    role: claims.role,
    rank: claims.rank,
    firstName: claims.first_name,
    lastName: claims.last_name,
  });
});

/** Member-safe, read-only audience projection controlled independently from execution. */
bid.get('/presentation', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const bidSessionId = await resolveBidSessionId(c, c.req.query('bidSessionId'));
  if (bidSessionId === null) return c.json({ mode: 'OFF', session: null });
  const [canonical, session, frozen] = await Promise.all([
    loadCanonicalBidSessionState(c.env.DB, bidSessionId),
    getDb(c.env.DB)
      .select({ bidYear: bidSessionsTable.bidYear, isMock: bidSessionsTable.isMock })
      .from(bidSessionsTable)
      .where(eq(bidSessionsTable.id, bidSessionId))
      .get(),
    loadFrozenSessionBidPolicy(getDb(c.env.DB), bidSessionId),
  ]);
  if (session === undefined || !frozen.ok)
    return c.json({ error: 'presentation_state_unavailable' }, 409);
  if (canonical === null)
    return c.json({ mode: 'OFF', session: { id: bidSessionId, bid_year: session.bidYear } });
  const presentation = canonical.live?.presentation ?? null;
  if (presentation === null || presentation.mode === 'OFF')
    return c.json({ mode: 'OFF', session: { id: bidSessionId, bid_year: session.bidYear } });
  const held = presentation.mode === 'HOLD' ? presentation.heldProjection : null;
  const fills = held?.fills ?? canonical.fills;
  const order = held?.bidOrder ?? canonical.bidOrder;
  const queueCursor = held?.queueCursor ?? canonical.queueCursor;
  const currentBidderId = held?.currentBidderId ?? canonical.currentBidderId;
  const currentPhase = held?.currentPhase ?? canonical.currentPhase;
  const currentStageId = held?.currentStageId ?? canonical.live?.currentStageId ?? null;
  const specialtyState = held?.specialty ?? canonical.live?.specialty ?? null;
  const identities = new Map(
    (frozen.snapshot.operatorIdentityProjection ?? []).map((identity) => [
      identity.memberId,
      identity,
    ]),
  );
  const safeMember = (memberId: number | null) => {
    if (memberId === null) return null;
    const identity = identities.get(memberId);
    return identity === undefined
      ? { member_id: memberId, name: `Member ${memberId}`, rank: null }
      : {
          member_id: memberId,
          name: `${identity.firstName} ${identity.lastName}`,
          rank: identity.rank,
        };
  };
  const biddablePositionIds = new Set(
    frozen.snapshot.v === 3
      ? frozen.snapshot.ruleBookMaterial.rules.map((rule) => rule.positionId)
      : [],
  );
  const positions =
    frozen.snapshot.v === 3
      ? frozen.snapshot.ruleBookMaterial.positions.filter((position) =>
          biddablePositionIds.has(position.id),
        )
      : [];
  const specialtyPolicy =
    frozen.snapshot.settings.v === 3 && specialtyState !== null
      ? frozen.snapshot.settings.livePolicy.annualOperations?.specialties?.find(
          (specialty) => specialty.id === specialtyState.specialtyId,
        )
      : undefined;
  return c.json({
    mode: presentation.mode,
    held_at_sequence: presentation.heldAtSeq,
    sequence: canonical.lastSeq,
    session: { id: bidSessionId, bid_year: session.bidYear, is_mock: session.isMock },
    current_stage: {
      id: currentStageId,
      label:
        frozen.snapshot.settings.v === 3
          ? (frozen.snapshot.settings.livePolicy.stages.find((stage) => stage.id === currentStageId)
              ?.label ?? currentStageId)
          : currentStageId,
    },
    current_bidder: safeMember(currentBidderId),
    on_deck: order
      .slice(queueCursor + 1, queueCursor + 3)
      .map((entry) => safeMember(entry.memberId)),
    phase: currentPhase,
    paused: currentPhase === 'paused',
    complete: currentPhase === 'complete',
    progress: { filled: Object.keys(fills).length, total: positions.length },
    positions: positions.map((position) => ({
      id: position.id,
      shift: position.shift,
      station: position.station,
      unit: position.unit,
      position_name: position.positionName,
      rank_required: position.rankRequired,
      filled_by: safeMember(fills[position.id]?.memberId ?? null),
    })),
    specialty:
      specialtyState === null
        ? null
        : {
            active: true,
            label: specialtyPolicy?.label ?? specialtyState.specialtyId,
            position_id: specialtyState.positionId,
            status: 'PRIORITY REVIEW IN PROGRESS',
          },
  });
});

/**
 * Member-safe published annual result. The roster is the immutable snapshot
 * created at finalization review, never a projection of today's personnel
 * record or an unpublished Command Staff work item.
 */
bid.get('/me/post-bid-result', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const sessionId = readSessionQuery(c);
  if (!sessionId || sessionId.trim() === '') return c.json({ error: 'session_required' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT bid_year, policy_version, effective_on, annual_completion_at, published_at, future_roster_json
         FROM bid_post_bid_transitions WHERE bid_session_id = ? AND status = 'PUBLISHED'`,
  )
    .bind(sessionId)
    .first<{
      bid_year: number;
      policy_version: string;
      effective_on: string;
      annual_completion_at: number;
      published_at: number;
      future_roster_json: string;
    }>();
  if (row === null) return c.json({ error: 'results_not_published' }, 404);
  let roster: TransitionRosterEntry[];
  try {
    roster = JSON.parse(row.future_roster_json) as TransitionRosterEntry[];
  } catch {
    return c.json({ error: 'published_results_unavailable' }, 503);
  }
  const result = roster.find((entry) => entry.memberId === claims.member_id);
  if (result === undefined) return c.json({ error: 'member_not_in_published_results' }, 404);
  return c.json({
    annualSessionId: result.annualSessionId,
    annualBidYear: row.bid_year,
    completionAt: row.annual_completion_at,
    effectiveOn: row.effective_on,
    publishedAt: row.published_at,
    policyVersion: row.policy_version,
    ruleBookVersion: result.ruleBookVersion,
    result: {
      assignment: result.position,
      positionId: result.positionId,
      shift: result.shift,
      station: result.station,
      unit: result.unit,
      aDay: result.aDay,
      specialty: result.specialty,
    },
  });
});

bid.get('/me/eligibility', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const db = getDb(c.env.DB);
  let sessionId: string | null;
  try {
    sessionId = await resolveBidSessionId(c, readSessionQuery(c));
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
  if (!sessionId) return c.json({ error: 'no_active_session' }, 404);
  const session = await db
    .select({ id: bidSessionsTable.id, bidYear: bidSessionsTable.bidYear })
    .from(bidSessionsTable)
    .where(eq(bidSessionsTable.id, sessionId))
    .get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);

  let canonicalState: BidSessionState | null;
  try {
    canonicalState = await loadCanonicalBidSessionState(c.env.DB, sessionId);
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }

  // Session pool membership and the associated policy version are frozen at
  // creation. Never fall back to the mutable active rule book here.
  const frozenPolicy = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozenPolicy.ok) {
    return c.json(
      { error: 'session_policy_snapshot_unavailable', policy_error: frozenPolicy.code },
      409,
    );
  }
  const frozenMember = frozenPolicy.snapshot.members.find(
    (entry) => entry.memberId === claims.member_id,
  );
  if (frozenMember === undefined) {
    return c.json({ error: 'member_not_in_session_policy_snapshot' }, 403);
  }
  const version = frozenPolicy.snapshot.ruleBookVersion;
  const requestedVersion = c.req.query('rule_book_version');
  if (requestedVersion !== undefined && requestedVersion !== version) {
    return c.json(
      {
        error: 'rule_book_version_not_active',
        requested_version: requestedVersion,
        active_version: version,
      },
      409,
    );
  }
  if (frozenMember.pool === 'EXCLUDED') {
    return c.json({
      memberId: claims.member_id,
      excluded_from_bid_pool: true,
      exclusion_reason: frozenMember.exclusionReason,
      rule_book_version: version,
      positions: [],
    });
  }

  const filled = new Set<string>();
  if (canonicalState !== null) {
    for (const positionId of Object.keys(canonicalState.fills)) filled.add(positionId);
  } else {
    const rows = await db
      .select({ positionId: bidsTable.positionId })
      .from(bidsTable)
      .where(eq(bidsTable.bidSessionId, sessionId))
      .all();
    for (const row of rows) filled.add(row.positionId);
  }

  const eligibilityMember = frozenEligibilityMemberForSession(
    frozenPolicy.snapshot,
    claims.member_id,
  );
  if (eligibilityMember === null) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }

  const positions: Array<{
    positionId: string;
    eligible: boolean;
    reasons: ReturnType<typeof evaluateEligibility>['reasons'];
    points: number;
  }> = [];
  for (const rule of frozenPolicy.coverage.rules) {
    if (filled.has(rule.positionId)) continue;
    const result = evaluateEligibility(eligibilityMemberFromFrozen(eligibilityMember), rule);
    positions.push({
      positionId: rule.positionId,
      eligible: result.eligible,
      reasons: result.reasons,
      points: result.points,
    });
  }

  return c.json({
    memberId: claims.member_id,
    rule_book_version: version,
    position_template_version: frozenPolicy.snapshot.positionTemplateVersion,
    positions,
  });
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
  let bidSessionId: string | null;
  try {
    bidSessionId = await resolveBidSessionId(c, readSessionQuery(c));
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
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
  // Also ships `sessionStartedAt` so the admin command bar can compute the
  // session-uptime clock without a separate fetch.
  //
  // Additionally pulls `currentPhase` and `currentBidderId` from D1 so we can
  // override the DO snapshot when admin endpoints (rehearsal auto-bid, manual
  // bid-for-member, force-pick) have committed picks directly to D1 without
  // round-tripping through the DO. The DO's in-memory state stays cold in
  // those scenarios, leaving phase='config' / currentBidderId=null forever.
  // D1 is the durable source of truth; the DO is a session-scoped buffer.
  let isMock = false;
  let sessionStartedAt: number | null = null;
  let d1Phase: string | null = null;
  let d1CurrentBidderId: number | null = null;
  let mockControlRevision: number | null = null;
  let canonicalState: BidSessionState | null = null;
  try {
    const db = getDb(c.env.DB);
    const session = await db
      .select({
        isMock: bidSessionsTable.isMock,
        startedAt: bidSessionsTable.startedAt,
        currentPhase: bidSessionsTable.currentPhase,
        currentBidderId: bidSessionsTable.currentBidderId,
        mockControlRevision: bidSessionsTable.mockControlRevision,
      })
      .from(bidSessionsTable)
      .where(eq(bidSessionsTable.id, bidSessionId))
      .get();
    isMock = session?.isMock === true;
    if (session?.startedAt instanceof Date) {
      sessionStartedAt = session.startedAt.getTime();
    }
    d1Phase = session?.currentPhase ?? null;
    d1CurrentBidderId = session?.currentBidderId ?? null;
    mockControlRevision = session?.mockControlRevision ?? null;
  } catch {
    // Best-effort legacy enrichment remains available when D1 is unavailable.
  }

  try {
    canonicalState = await loadCanonicalBidSessionState(c.env.DB, bidSessionId);
  } catch {
    // Once canonical authority is introduced, serving an unverified legacy
    // projection would be misleading. Refuse the board response until D1 can
    // provide or rule out that state.
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }

  if (canonicalState !== null) {
    // The canonical row is the only authority after a mock command commits.
    // Do not overlay stale bid_sessions fields or a cold DO snapshot on top
    // of its paused/frozen state.
    body.currentPhase = canonicalState.currentPhase;
    body.currentBidderId = canonicalState.currentBidderId;
    body.turnStartedAtMs = canonicalState.turnStartedAtMs;
    body.turnTimerSeconds = canonicalState.turnTimerSeconds;
    body.lastSeq = canonicalState.lastSeq;
    body.fills = { ...canonicalState.fills };
    body.bidOrder = [...canonicalState.bidOrder];
    body.queueCursor = canonicalState.queueCursor;
    body.frozenAt = canonicalState.frozenAt;
    body.aDay = canonicalState.aDay;
    // This is a read model only. All mutations still cross canonical commands.
    body.annual = canonicalState.annual;
  }

  // Merge D1-committed bids into the fills map. Auto-bid / admin bid-for-
  // member / force-pick all commit straight to D1; the DO never sees them.
  // Without this merge, /admin/bid renders "all WAITING" even though the
  // rehearsal console reports picks made.
  try {
    const db = getDb(c.env.DB);
    const dbBidRows = await db
      .select({
        id: bidsTable.id,
        memberId: bidsTable.memberId,
        positionId: bidsTable.positionId,
        ordinal: bidsTable.ordinal,
      })
      .from(bidsTable)
      .where(eq(bidsTable.bidSessionId, bidSessionId))
      .all();
    body.fills = mergeFills(body.fills, dbBidRows);
  } catch (err) {
    console.error('[bid.board] D1 fills merge failed (fail-soft)', err);
  }

  if (canonicalState === null) {
    body.currentPhase = resolvePhase(body.currentPhase, d1Phase);
    body.currentBidderId = resolveCurrentBidderId(body.currentBidderId, d1CurrentBidderId);
  }

  // The durable state and direct-D1 rehearsal paths may both surface an
  // order/fill projection. Validate every element against the session's
  // frozen policy before enriching it for the board: an old global-roster
  // order or a Division Chief fill must never be rendered as ordinary Bid.
  const db = getDb(c.env.DB);
  let frozenBoardPolicy: Awaited<ReturnType<typeof loadFrozenSessionBidPolicy>>;
  try {
    frozenBoardPolicy = await loadFrozenSessionBidPolicy(db, bidSessionId);
  } catch {
    return c.json({ error: 'session_policy_snapshot_unavailable' }, 503);
  }
  if (!frozenBoardPolicy.ok) {
    return c.json(
      { error: 'session_policy_snapshot_unavailable', policy_error: frozenBoardPolicy.code },
      409,
    );
  }
  const legacyFrozenOrder = computeBidOrder(bidOrderInputFromSnapshot(frozenBoardPolicy.snapshot));
  const modernFrozenOrder =
    frozenBoardPolicy.snapshot.settings.v === 3
      ? computeFrozenStageOrder(
          frozenBoardPolicy.snapshot,
          frozenBoardPolicy.snapshot.settings.livePolicy,
        )
      : null;
  if (modernFrozenOrder !== null && !modernFrozenOrder.ok)
    return c.json(
      { error: 'bid_order_not_frozen_policy', policy_error: modernFrozenOrder.code },
      409,
    );
  const poolByMember = new Map(
    frozenBoardPolicy.snapshot.members.map((member) => [member.memberId, member.pool]),
  );
  const frozenOrder =
    modernFrozenOrder?.ok === true
      ? modernFrozenOrder.entries.map((entry) => ({
          ...entry,
          pool: poolByMember.get(entry.memberId) as 'OFC' | 'FF',
        }))
      : legacyFrozenOrder;
  const frozenMemberIds = new Set(
    frozenBoardPolicy.snapshot.members
      .filter((member) => member.pool !== 'EXCLUDED')
      .map((member) => member.memberId),
  );
  const biddablePositionIds = new Set(
    frozenBoardPolicy.coverage.rules.map((rule) => rule.positionId),
  );
  const bodyOrder = Array.isArray(body.bidOrder) ? body.bidOrder : [];
  const validBodyOrder =
    canonicalState === null
      ? orderMatchesFrozenSnapshot(bodyOrder, frozenOrder)
      : canonicalOrderUsesFrozenMembership(bodyOrder, frozenOrder);
  if (bodyOrder.length > 0 && !validBodyOrder) {
    return c.json({ error: 'bid_order_not_frozen_policy' }, 409);
  }
  const boardFills = body.fills && typeof body.fills === 'object' ? body.fills : {};
  for (const [positionId, fill] of Object.entries(boardFills)) {
    if (!biddablePositionIds.has(positionId) || !frozenMemberIds.has(fill.memberId)) {
      return c.json({ error: 'bid_state_not_frozen_policy' }, 409);
    }
  }
  if (typeof body.currentBidderId === 'number' && !frozenMemberIds.has(body.currentBidderId)) {
    return c.json({ error: 'bid_state_not_frozen_policy' }, 409);
  }

  // Live Bid Console enrichment derives its display map from immutable session
  // material only. Authorized operators receive the freeze-bound identity
  // projection; ordinary members never receive this directory-like material.
  let currentBidder: BidderContext | null = null;
  let onDeck: BidderContext[] = [];
  const members: Record<
    string,
    {
      id: number;
      firstName: string;
      lastName: string;
      rank: string;
      employeeId: string;
      priorPositionId: string | null;
    }
  > = {};
  // When the DO has no materialized order, render the order derived from the
  // frozen policy snapshot rather than consulting the mutable global roster.
  // Only a brand-new `config` session is a preview: a paused or completed
  // session can legitimately restore that same frozen order after DO state
  // compaction, and must not be labelled as "session not started".
  let bidOrder: ReadonlyArray<{ ordinal: number; memberId: number; pool: 'OFC' | 'FF' }> =
    bodyOrder;
  let bidOrderPreview = false;
  if (bidOrder.length === 0 && frozenOrder.length > 0) {
    bidOrder = frozenOrder;
    bidOrderPreview = body.currentPhase === 'config';
  }

  const currentBidderId = typeof body.currentBidderId === 'number' ? body.currentBidderId : null;
  const fillsRec = body.fills && typeof body.fills === 'object' ? body.fills : {};
  const filledMemberIds = new Set<number>(Object.values(fillsRec).map((f) => f.memberId));
  const onDeckEntries = computeOnDeck(bidOrder, currentBidderId, filledMemberIds);
  const snapshotMembersById = new Map(
    frozenBoardPolicy.snapshot.members.map((member) => [member.memberId, member]),
  );
  const operatorIdentityByMember =
    claims.role === 'admin'
      ? new Map(
          (frozenBoardPolicy.snapshot.operatorIdentityProjection ?? []).map((identity) => [
            identity.memberId,
            identity,
          ]),
        )
      : new Map();
  const bidOrderIndex = new Map(bidOrder.map((entry) => [entry.memberId, entry]));
  const lookupIds = new Set<number>();
  for (const entry of bidOrder) lookupIds.add(entry.memberId);
  for (const memberId of filledMemberIds) lookupIds.add(memberId);
  if (currentBidderId !== null) lookupIds.add(currentBidderId);
  for (const entry of onDeckEntries) lookupIds.add(entry.memberId);

  for (const memberId of lookupIds) {
    const member = snapshotMembersById.get(memberId);
    if (member === undefined) continue;
    const identity = operatorIdentityByMember.get(memberId);
    members[String(memberId)] = {
      id: memberId,
      firstName: identity?.firstName ?? 'Member',
      lastName: identity?.lastName ?? `#${memberId}`,
      rank: identity?.rank ?? member.rank,
      employeeId: identity?.employeeId ?? `#${memberId}`,
      priorPositionId: null,
    };
  }
  if (currentBidderId !== null) {
    const member = snapshotMembersById.get(currentBidderId);
    const order = bidOrderIndex.get(currentBidderId);
    const identity = operatorIdentityByMember.get(currentBidderId);
    if (member !== undefined && order !== undefined) {
      currentBidder = {
        memberId: member.memberId,
        ordinal: order.ordinal,
        pool: order.pool,
        firstName: identity?.firstName ?? 'Member',
        lastName: identity?.lastName ?? `#${member.memberId}`,
        rank: identity?.rank ?? member.rank,
        employeeId: identity?.employeeId ?? `#${member.memberId}`,
      };
    }
  }
  onDeck = onDeckEntries.flatMap((entry) => {
    const member = snapshotMembersById.get(entry.memberId);
    const identity = operatorIdentityByMember.get(entry.memberId);
    if (member === undefined) return [];
    return [
      {
        memberId: member.memberId,
        ordinal: entry.ordinal,
        pool: entry.pool,
        firstName: identity?.firstName ?? 'Member',
        lastName: identity?.lastName ?? `#${member.memberId}`,
        rank: identity?.rank ?? member.rank,
        employeeId: identity?.employeeId ?? `#${member.memberId}`,
      },
    ];
  });

  return c.json({
    ...body,
    isMock,
    mockControlRevision,
    bidSessionId,
    sessionStartedAt,
    bidOrder,
    bidOrderPreview,
    currentBidder,
    onDeck,
    members,
    positions: frozenBoardPolicy.snapshot.ruleBookMaterial.positions,
  });
});

bid.get('/bid/state', async (c) => {
  const claims = await requireJwt(c);
  if (!claims) return c.json({ error: 'missing_auth' }, 401);
  const sinceSeq = Number(c.req.query('since_seq') ?? '0');
  let bidSessionId: string | null;
  try {
    bidSessionId = await resolveBidSessionId(c, readSessionQuery(c));
  } catch {
    return c.json({ error: 'canonical_state_unavailable' }, 503);
  }
  if (!bidSessionId) return c.json({ error: 'no_active_session' }, 404);
  const doId = c.env.BID_SESSION.idFromName(bidSessionId);
  const stub = c.env.BID_SESSION.get(doId);
  const snap = await stub.fetch(`${new URL(c.req.url).origin}/snapshot`);
  const state = (await snap.json()) as { lastSeq: number };
  return c.json({ seq: state.lastSeq, since: sinceSeq, events: [], state });
});

// ---------- Plan 07 Phase 2 (A-Day) REST routes ----------

/**
 * A-Day capacity/order checks require rank and seniority. Fresh sessions read
 * them only from their V3 frozen member projection, never from the mutable
 * current roster after a mock or live session has been created.
 */
async function loadFrozenMembersForADay(
  c: BidContext,
  bidSessionId: string,
): Promise<Member[] | null> {
  const policy = await loadFrozenSessionBidPolicy(getDb(c.env.DB), bidSessionId);
  if (!policy.ok || policy.snapshot.v !== 3) return null;
  return policy.snapshot.members
    .filter((member) => member.pool !== 'EXCLUDED')
    .map(
      (member): Member => ({
        ...eligibilityMemberFromFrozen(member),
        employeeId: String(member.memberId),
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

  const memberId = claims.member_id;
  const members = await loadFrozenMembersForADay(c, sessionId);
  if (members === null) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }
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
  const memberId = claims.member_id;
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
  // A-Day self-service is rehearsal-only. A live A-Day change must use a
  // separately authorized operator command once the annual A-Day policy has
  // been approved; a member JWT can never mutate it through this fallback.
  const session = await getDb(c.env.DB)
    .select({ isMock: bidSessionsTable.isMock })
    .from(bidSessionsTable)
    .where(eq(bidSessionsTable.id, parsed.data.bidSessionId))
    .get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (!session.isMock) return c.json({ error: 'live_member_a_day_mutation_forbidden' }, 403);
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

  const members = await loadFrozenMembersForADay(c, parsed.data.bidSessionId);
  if (members === null) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }
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
