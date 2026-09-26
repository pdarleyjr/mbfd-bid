import { zValidator } from '@hono/zod-validator';
import { type ADayState, COMBAT_GROUPS, WEEKDAYS, canPick } from '@mbfd/a-day';
import { evaluateEligibility } from '@mbfd/eligibility';
import {
  AmendSelectionSchema,
  BidForMemberSchema,
  ForcePickSchema,
  type JwtPayload,
  LiveBidCommandSchema,
  LockPositionSchema,
  SkipSchema,
  isLiveBidActionAuthorized,
} from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { ulid } from 'ulid';
import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidSessions } from '../../db/schema.js';
import { hydrateADayState } from '../../durable/bid-session-aday-handlers.js';
import type { BidSessionState } from '../../durable/bid-session-state.js';
import { rankFrozenSpecialtyCandidates } from '../../lib/annual-specialty-policy.js';
import { auditInsertStatement } from '../../lib/audit.js';
import { BidDefinitionSnapshotPinSchema } from '../../lib/bid-definition-pin.js';
import { evaluateBidFallback } from '../../lib/bid-fallback.js';
import { projectBidOpportunityPools } from '../../lib/bid-opportunity-pool.js';
import {
  type FrozenSessionBidPolicy,
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
  resolveFrozenSessionBidTarget,
} from '../../lib/bid-policy.js';
import { unresolvedSpecialtyPriority } from '../../lib/canonical-specialty-priority.js';
import { requiresCanonicalBidMutation } from '../../lib/legacy-bid-mutation-boundary.js';
import { loadOfficialAnnualCompletion } from '../../lib/official-annual-completion.js';
import { isReasonValidForAction } from '../../lib/reason-codes.js';
import { adviseFrozenSpecialtyCoverage } from '../../lib/specialty-coverage-advisory.js';
import { runWithNormalBidMutationLease } from '../../lib/specialty-interruption-guard.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin, requireLiveBidAction } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

function frozenPolicyFailureStatus(code: string): 409 | 422 {
  return code.startsWith('session_') ? 409 : 422;
}

async function loadLiveAdapterState(
  env: WorkerEnv,
  sessionId: string,
): Promise<BidSessionState | null> {
  const canonical = await loadCanonicalBidSessionState(env.DB, sessionId);
  if (canonical !== null) return canonical;
  const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(sessionId));
  const response = await stub.fetch('https://bid.internal/admin/state/live');
  return response.ok ? ((await response.json()) as BidSessionState) : null;
}

type SpecialtyCoverageProjection =
  | {
      availability: 'AVAILABLE';
      source: 'FROZEN_SESSION_SNAPSHOT';
      status: 'FEASIBLE' | 'AT_RISK' | 'SHORTAGE';
      total_specialty_seat_count: number;
      filled_specialty_seat_count: number;
      remaining_specialty_seat_count: number;
      maximum_remaining_covered_count: number;
      guaranteed_uncovered_seat_count: number;
      unmatched_seat_ids: readonly string[];
      critical_member_ids: readonly number[];
      rule_groups: ReadonlyArray<{
        rule_group_id: string;
        total_seat_count: number;
        filled_seat_count: number;
        remaining_seat_count: number;
        simple_eligible_member_ids: readonly number[];
      }>;
    }
  | {
      availability: 'UNAVAILABLE';
      source: 'FROZEN_SESSION_SNAPSHOT';
      code: string;
    };

function unavailableSpecialtyCoverage(code: string): SpecialtyCoverageProjection {
  return { availability: 'UNAVAILABLE', source: 'FROZEN_SESSION_SNAPSHOT', code };
}

/**
 * Builds an advisory graph from immutable session policy only.  In particular,
 * this helper intentionally receives no current roster, credential, or
 * eligibility source: a missing frozen rule or specialty fact is surfaced as
 * unavailable instead of being reconstructed from mutable Department data.
 */
function projectFrozenSpecialtyCoverage(input: {
  frozen: Extract<FrozenSessionBidPolicy, { ok: true }>;
  canonical: BidSessionState;
}): SpecialtyCoverageProjection {
  if (input.frozen.snapshot.settings.v !== 3)
    return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_POLICY_MISSING');
  const annualOperations = input.frozen.snapshot.settings.livePolicy.annualOperations;
  const specialties = annualOperations?.specialties;
  if (annualOperations === undefined || specialties === undefined)
    return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_POLICY_MISSING');
  const evaluationOn = input.frozen.snapshot.credentialEvaluationOn;
  if (evaluationOn === undefined)
    return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_EVIDENCE_DATE_MISSING');

  const specialtyIds = new Set<string>();
  const positionIds = new Set<string>();
  try {
    const frozenCandidates = input.frozen.snapshot.members
      .filter((member) => member.pool !== 'EXCLUDED')
      .map((member) => ({
        memberId: member.memberId,
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority,
        bidOrdinalEvidence: member.bidOrdinalEvidence,
        credentialNames: member.credentialNames,
        scoringEvidence: member.scoringEvidence,
        specialtyQualifications: member.specialtyQualifications,
      }));
    const specialtySeats: Array<{
      seatId: string;
      positionId: string;
      ruleGroupId: string;
      filled: boolean;
    }> = [];
    const frozenEligibilityEdges: Array<{ seatId: string; memberId: number }> = [];

    for (const specialty of specialties) {
      if (specialtyIds.has(specialty.id))
        return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_DUPLICATE_SPECIALTY');
      specialtyIds.add(specialty.id);
      const rankedCandidateIds = new Set(
        rankFrozenSpecialtyCandidates({
          policy: specialty,
          evaluationOn,
          members: frozenCandidates,
        }).map((candidate) => candidate.memberId),
      );

      for (const positionId of specialty.opportunityPositionIds) {
        // One physical opportunity cannot be silently counted as two independent
        // specialty seats. Its policy relationship needs explicit review.
        if (positionIds.has(positionId))
          return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_AMBIGUOUS_POSITION');
        positionIds.add(positionId);
        const rule = input.frozen.coverage.rules.find(
          (candidate) => candidate.positionId === positionId,
        );
        if (rule === undefined)
          return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_POSITION_RULE_MISSING');
        const seatId = `specialty:${encodeURIComponent(specialty.id)}:position:${encodeURIComponent(positionId)}`;
        specialtySeats.push({
          seatId,
          positionId,
          ruleGroupId: specialty.id,
          filled: input.canonical.fills[positionId] !== undefined,
        });
        for (const memberId of rankedCandidateIds) {
          const member = frozenEligibilityMemberForSession(input.frozen.snapshot, memberId);
          if (member === null || member.pool === 'EXCLUDED')
            return unavailableSpecialtyCoverage('SPECIALTY_COVERAGE_MEMBER_MATERIAL_MISSING');
          if (evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible)
            frozenEligibilityEdges.push({ seatId, memberId });
        }
      }
    }

    const advisory = adviseFrozenSpecialtyCoverage({
      // The calculation deliberately has identical Mock/Live semantics; the
      // route does not read mutable session metadata merely to choose this label.
      mode: 'live',
      frozenMembers: input.frozen.snapshot.members.map((member) => ({
        memberId: member.memberId,
        pool: member.pool,
      })),
      specialtySeats,
      frozenEligibilityEdges,
      assignedMemberIds: Object.values(input.canonical.fills).map((fill) => fill.memberId),
    });
    return {
      availability: 'AVAILABLE',
      source: 'FROZEN_SESSION_SNAPSHOT',
      status: advisory.status,
      total_specialty_seat_count: advisory.totalSpecialtySeatCount,
      filled_specialty_seat_count: advisory.filledSpecialtySeatCount,
      remaining_specialty_seat_count: advisory.remainingSpecialtySeatCount,
      maximum_remaining_covered_count: advisory.maximumRemainingCoveredCount,
      guaranteed_uncovered_seat_count: advisory.guaranteedUncoveredSeatCount,
      unmatched_seat_ids: advisory.unmatchedSeatIds,
      critical_member_ids: advisory.criticalMemberIds,
      rule_groups: advisory.ruleGroups.map((group) => ({
        rule_group_id: group.ruleGroupId,
        total_seat_count: group.totalSeatCount,
        filled_seat_count: group.filledSeatCount,
        remaining_seat_count: group.remainingSeatCount,
        simple_eligible_member_ids: group.simpleEligibleMemberIds,
      })),
    };
  } catch (error) {
    const code =
      error instanceof Error ? error.message : 'SPECIALTY_COVERAGE_EVALUATION_UNAVAILABLE';
    return unavailableSpecialtyCoverage(
      code.startsWith('SPECIALTY_') ? code : 'SPECIALTY_COVERAGE_EVALUATION_UNAVAILABLE',
    );
  }
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.get('/:id/results', async (c) => {
  c.header('Cache-Control', 'no-store');
  const sessionId = c.req.param('id');
  const db = getDb(c.env.DB);
  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (!session) return c.json({ error: 'session_not_found' }, 404);
  const [canonical, frozen, official] = await Promise.all([
    loadCanonicalBidSessionState(c.env.DB, sessionId),
    loadFrozenSessionBidPolicy(db, sessionId),
    loadOfficialAnnualCompletion(c.env.DB, sessionId),
  ]);
  const snapshot = frozen.ok ? frozen.snapshot : null;
  const pin =
    snapshot && 'bidDefinition' in snapshot
      ? BidDefinitionSnapshotPinSchema.safeParse(snapshot.bidDefinition)
      : null;
  const positions = new Map(snapshot?.ruleBookMaterial.positions.map((p) => [p.id, p]));
  const names = new Map(
    snapshot?.operatorIdentityProjection?.map((person) => [
      person.memberId,
      `${person.firstName} ${person.lastName}`.trim(),
    ]),
  );
  return c.json({
    session: {
      id: sessionId,
      bidYear: session.bidYear,
      isMock: session.isMock,
      currentPhase: canonical?.currentPhase ?? session.currentPhase,
      sequence: canonical?.lastSeq ?? null,
    },
    awardSource: canonical === null ? 'CANONICAL_UNAVAILABLE' : 'CANONICAL',
    provenance: {
      valid: frozen.ok,
      error: frozen.ok ? null : frozen.code,
      pin: pin?.success ? pin.data : null,
      ruleBookVersion: snapshot?.ruleBookVersion ?? null,
      topologyReference: snapshot?.positionTemplateVersion ?? null,
    },
    awards: Object.entries(canonical?.fills ?? {}).map(([positionId, fill]) => {
      const position = positions.get(positionId);
      const pool =
        snapshot?.settings.v === 3
          ? snapshot.settings.livePolicy.annualOperations?.opportunityPools?.find((entry) =>
              entry.positionIds.includes(positionId),
            )
          : undefined;
      return {
        memberId: fill.memberId,
        name: names.get(fill.memberId) ?? null,
        memberships:
          snapshot?.settings.v === 3
            ? (snapshot.settings.livePolicy.annualOperations?.membershipDistributions ?? [])
                .filter((entry) =>
                  entry.membershipSource === 'REVIEWED_QUALIFIED_POOL'
                    ? fill.membershipIds?.includes(entry.id)
                    : entry.memberIds.includes(fill.memberId),
                )
                .map(({ id, label }) => ({ id, label }))
            : [],
        positionId,
        pool: pool
          ? {
              id: pool.id,
              label: pool.label,
              kind: pool.kind,
              sourceRef: pool.sourceRef,
              sourceDecisionId: pool.sourceDecisionId,
            }
          : null,
        positionName: position?.positionName ?? null,
        shift: position?.shift ?? null,
        station: position?.station ?? null,
        unit: position?.unit ?? null,
        aDay:
          canonical?.aDay?.picks.find((pick) => pick.memberId === fill.memberId)?.aDay ??
          fill.aDay ??
          null,
      };
    }),
    completion: { verified: official.ok, blockers: official.ok ? [] : [official.error] },
  });
});

router.get('/:id/completion', async (c) => {
  c.header('Cache-Control', 'no-store');
  const result = await loadOfficialAnnualCompletion(c.env.DB, c.req.param('id'));
  return result.ok
    ? c.json({ ok: true, completion: result.completion })
    : c.json({ ok: false, error: result.error }, result.error === 'session_not_found' ? 404 : 200);
});

router.get('/:id/specialty-live', async (c) => {
  const sessionId = c.req.param('id');
  const [canonical, frozen] = await Promise.all([
    loadLiveAdapterState(c.env, sessionId),
    loadFrozenSessionBidPolicy(getDb(c.env.DB), sessionId),
  ]);
  if (canonical === null) return c.json({ error: 'live_state_missing' }, 409);
  if (!frozen.ok || frozen.snapshot.settings.v !== 3)
    return c.json({ error: 'live_action_policy_missing' }, 409);
  const policy = frozen.snapshot.settings.livePolicy;
  const specialtyCoverage = projectFrozenSpecialtyCoverage({ frozen, canonical });
  const identities = new Map(
    (frozen.snapshot.operatorIdentityProjection ?? []).map((identity) => [
      identity.memberId,
      identity,
    ]),
  );
  const member = (memberId: number) => {
    const identity = identities.get(memberId);
    return {
      member_id: memberId,
      first_name: identity?.firstName ?? '',
      last_name: identity?.lastName ?? '',
      rank: identity?.rank ?? null,
    };
  };
  const active = canonical.live?.specialty ?? null;
  let activeProjection: Record<string, unknown> | null = null;
  if (active !== null) {
    const specialty = policy.annualOperations?.specialties?.find(
      (candidate) => candidate.id === active.specialtyId,
    );
    if (specialty === undefined || frozen.snapshot.credentialEvaluationOn === undefined)
      return c.json({ error: 'live_specialty_policy_missing' }, 409);
    let ranked: ReturnType<typeof rankFrozenSpecialtyCandidates>;
    try {
      ranked = rankFrozenSpecialtyCandidates({
        policy: specialty,
        evaluationOn: frozen.snapshot.credentialEvaluationOn,
        members: frozen.snapshot.members.map((candidate) => ({
          memberId: candidate.memberId,
          rscSeniority: candidate.rscSeniority,
          rankSeniority: candidate.rankSeniority,
          bidOrdinalEvidence: candidate.bidOrdinalEvidence,
          credentialNames: candidate.credentialNames,
          scoringEvidence: candidate.scoringEvidence,
          specialtyQualifications: candidate.specialtyQualifications,
        })),
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'live_specialty_policy_invalid' },
        409,
      );
    }
    const byMember = new Map(
      ranked.map((candidate, index) => [
        candidate.memberId,
        { points: candidate.points, policy_rank: index + 1 },
      ]),
    );
    const currentCandidateId = active.candidateMemberIds[active.candidateCursor] ?? null;
    const attempts = canonical.annual?.contactAttempts ?? [];
    activeProjection = {
      specialty_id: active.specialtyId,
      specialty_label: specialty.label,
      requested_position_id: active.positionId,
      original_bidder: {
        ...member(active.suspendedBidderId),
        ...byMember.get(active.suspendedBidderId),
      },
      candidates: active.candidateMemberIds.map((memberId) => ({
        ...member(memberId),
        ...byMember.get(memberId),
        status:
          memberId === currentCandidateId
            ? 'CURRENT'
            : active.candidateMemberIds.indexOf(memberId) < active.candidateCursor
              ? 'RESOLVED'
              : 'REMAINING',
        contact_history: attempts
          .filter((attempt) => attempt.memberId === memberId)
          .map((attempt) => ({
            method: attempt.method,
            at_ms: attempt.atMs,
            actor_member_id: attempt.actorMemberId,
          })),
      })),
      current_candidate_id: currentCandidateId,
      remaining_candidate_ids: active.candidateMemberIds.slice(active.candidateCursor),
      suspended_turn: true,
      resume: {
        member_id: active.suspendedBidderId,
        queue_cursor: canonical.queueCursor,
        current_phase: canonical.currentPhase,
      },
    };
  }
  const opportunityPools = projectBidOpportunityPools(
    frozen.snapshot.ruleBookMaterial,
    policy,
    canonical.fills,
  );
  const aDayExecution = policy.annualOperations?.aDay.execution;
  const aDayTimingByPosition = Object.fromEntries(
    (aDayExecution?.timingExceptions ?? []).flatMap((exception) =>
      exception.positionIds.map((positionId) => [positionId, exception.timing] as const),
    ),
  );
  let aDayCurrent: {
    member_id: number;
    position_id: string;
    shift: 'A' | 'B' | 'C' | 'D';
    eligible_a_days: readonly string[];
  } | null = null;
  if (canonical.currentPhase === 'a_day_bid' && canonical.aDay !== null) {
    const membersById = new Map(
      frozen.snapshot.members
        .filter((candidate) => candidate.pool !== 'EXCLUDED')
        .map((candidate) => [
          candidate.memberId,
          { ...eligibilityMemberFromFrozen(candidate), employeeId: String(candidate.memberId) },
        ]),
    );
    const aDayState: ADayState = hydrateADayState(canonical.aDay, membersById);
    const memberId = canonical.currentBidderId;
    const phase1 = memberId === null ? undefined : aDayState.phase1ByMember.get(memberId);
    if (memberId !== null && phase1 !== undefined) {
      const candidates = phase1.shift === 'D' ? WEEKDAYS : COMBAT_GROUPS;
      aDayCurrent = {
        member_id: memberId,
        position_id: phase1.positionId,
        shift: phase1.shift,
        eligible_a_days: candidates.filter((aDay) => canPick(aDayState, memberId, aDay).ok),
      };
    }
  }
  return c.json({
    bid_session_id: sessionId,
    sequence: canonical.lastSeq,
    current_phase: canonical.currentPhase,
    finalization_ready: canonical.annual?.completion != null,
    membership_distributions: policy.annualOperations?.membershipDistributions ?? [],
    term_participation: Object.fromEntries(
      frozen.snapshot.members.flatMap((person) =>
        person.termParticipation ? [[String(person.memberId), person.termParticipation]] : [],
      ),
    ),
    current_bidder: canonical.currentBidderId === null ? null : member(canonical.currentBidderId),
    dispositions: policy.dispositions,
    unresolved_members: (canonical.annual?.unresolvedMemberIds ?? []).map(member),
    returning_member:
      canonical.annual?.returningMemberId == null
        ? null
        : member(canonical.annual.returningMemberId),
    remaining_order: canonical.bidOrder.slice(canonical.queueCursor).map((entry) => entry.memberId),
    fills: Object.fromEntries(
      Object.entries(canonical.fills).map(([positionId, fill]) => [
        positionId,
        {
          member_id: fill.memberId,
          a_day:
            canonical.aDay?.picks.find((pick) => pick.memberId === fill.memberId)?.aDay ??
            fill.aDay ??
            null,
          membership_ids: fill.membershipIds ?? [],
        },
      ]),
    ),
    specialties: (policy.annualOperations?.specialties ?? []).map((specialty) => ({
      id: specialty.id,
      label: specialty.label,
      mode: specialty.mode,
      positions: specialty.opportunityPositionIds.map((positionId) => {
        const position = frozen.snapshot.ruleBookMaterial.positions.find(
          (item) => item.id === positionId,
        );
        return {
          id: positionId,
          label:
            position === undefined
              ? positionId
              : `${position.station} ${position.unit} ${position.positionName}`,
        };
      }),
    })),
    specialty_coverage: specialtyCoverage,
    opportunity_pools: opportunityPools,
    a_day_selection: aDayExecution?.timing ?? null,
    a_day_timing_by_position: aDayTimingByPosition,
    a_day_combat_groups: policy.annualOperations?.aDay.combatGroups ?? [],
    a_day_current: aDayCurrent,
    fallbacks: (policy.annualOperations?.fallbackPolicies ?? []).flatMap((fallback) =>
      fallback.positionIds
        .filter(
          (id) =>
            canonical.fills[id] === undefined &&
            !opportunityPools.some(
              (pool) => pool.positionIds.includes(id) && pool.resolvedPositionId !== id,
            ),
        )
        .map((positionId) => {
          const result = evaluateBidFallback({
            snapshot: frozen.snapshot,
            state: canonical,
            positionId,
          });
          if (!result.ok)
            return {
              positionId,
              policyId: fallback.id,
              label: fallback.label,
              sourceRef: fallback.sourceRef,
              ...result,
            };
          const { rule: _rule, ...review } = result;
          const pool = policy.annualOperations?.opportunityPools?.find((entry) =>
            entry.positionIds.includes(positionId),
          );
          return { positionId, ...review, pool: pool ? { poolId: pool.id } : null };
        }),
    ),
    active: activeProjection,
  });
});

// The adapter deliberately assigns actor/session identity.  It is the one
// public entry point for real mutations; retired force/skip routes are
// explicit compatibility responses and cannot mutate session state.
router.post('/:id/commands/live', requireStepUpAuth(), async (c) => {
  const sessionId = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return c.json({ error: 'invalid_live_bid_command' }, 400);
  const claims = c.get('claims');
  const db = getDb(c.env.DB);
  const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozen.ok || frozen.snapshot.settings.v !== 3)
    return c.json({ error: 'live_action_policy_missing' }, 409);
  let normalizedRaw: Record<string, unknown> = raw;
  if (raw.type === 'live.start_specialty_adjudication') {
    const specialtyId = typeof raw.specialtyId === 'string' ? raw.specialtyId : null;
    const specialty = frozen.snapshot.settings.livePolicy.annualOperations?.specialties?.find(
      (entry) => entry.id === specialtyId,
    );
    if (specialty === undefined) return c.json({ error: 'live_specialty_policy_missing' }, 409);
    if (frozen.snapshot.credentialEvaluationOn === undefined)
      return c.json({ error: 'live_specialty_evidence_date_missing' }, 409);
    const canonical = await loadLiveAdapterState(c.env, sessionId);
    if (canonical === null || canonical.currentBidderId === null)
      return c.json({ error: 'live_specialty_requester_missing' }, 409);
    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: canonical.currentBidderId,
      positionId: typeof raw.positionId === 'string' ? raw.positionId : '',
    });
    if (!target.ok) return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));
    const requester = frozenEligibilityMemberForSession(frozen.snapshot, canonical.currentBidderId);
    if (requester === null) return c.json({ error: 'live_specialty_requester_missing' }, 409);
    if (!evaluateEligibility(eligibilityMemberFromFrozen(requester), target.rule).eligible)
      return c.json({ error: 'live_specialty_requester_position_ineligible' }, 409);
    try {
      const candidates =
        unresolvedSpecialtyPriority({
          snapshot: frozen.snapshot,
          state: canonical,
          memberId: canonical.currentBidderId,
          positionId: typeof raw.positionId === 'string' ? raw.positionId : '',
          rule: target.rule,
        }).find((entry) => entry.specialtyId === specialty.id)?.candidateMemberIds ?? [];
      if (candidates.length === 0)
        return c.json({ error: 'live_specialty_no_higher_priority_candidate' }, 409);
      normalizedRaw = {
        ...raw,
        candidateMemberIds: candidates,
      };
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'live_specialty_policy_invalid' },
        409,
      );
    }
  }
  const command = LiveBidCommandSchema.safeParse({
    ...normalizedRaw,
    bidSessionId: sessionId,
    actor: { id: claims.member_id, role: 'admin' },
  });
  if (!command.success) return c.json({ error: 'invalid_live_bid_command' }, 400);
  const action =
    command.data.type === 'live.record_fallback_response'
      ? command.data.outcome === 'UNREACHABLE'
        ? 'mark_unreachable'
        : 'skip_defer'
      : command.data.type === 'live.record_selection' || command.data.type === 'live.record_a_day'
        ? 'record_selection'
        : command.data.type === 'live.amend_selection'
          ? 'amend_selection'
          : command.data.type === 'live.force_selection'
            ? 'force'
            : command.data.type === 'live.disposition'
              ? command.data.disposition === 'UNREACHABLE'
                ? 'mark_unreachable'
                : 'skip_defer'
              : command.data.type === 'live.transition_stage'
                ? 'approve_transition'
                : command.data.type === 'live.alter_order'
                  ? 'alter_order'
                  : command.data.type === 'live.complete_session'
                    ? 'approve_final_results'
                    : command.data.type === 'live.record_contact_attempt' ||
                        command.data.type === 'live.declare_unreachable'
                      ? 'mark_unreachable'
                      : command.data.type === 'live.return_at_current_sequence'
                        ? 'skip_defer'
                        : command.data.type === 'live.set_presentation_mode'
                          ? 'publish'
                          : command.data.type === 'live.start_specialty_adjudication' ||
                              command.data.type === 'live.resolve_specialty_candidate'
                            ? 'approve_transition'
                            : 'pause_resume';
  if (!isLiveBidActionAuthorized(frozen.snapshot.settings.livePolicy, action, claims.member_id))
    return c.json({ error: 'live_action_forbidden', action }, 403);
  const stub = c.env.BID_SESSION.get(c.env.BID_SESSION.idFromName(sessionId));
  const response = await stub.fetch('https://bid.internal/admin/commands/live', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command.data),
  });
  return c.json(await response.json(), response.status as 200 | 400 | 409);
});

/** All Real selection writes, including historical noncanonical sessions, use
 * the sequenced canonical command endpoint. These retired URLs provide an
 * explicit compatibility response only; historical reads remain available.
 * Mock selections use the rehearsal/operator command path instead.
 */
async function retiredSelectionMutation(c: Context<Env>, command: string) {
  const sessionId = c.req.param('id');
  if (sessionId === undefined) return c.json({ error: 'session_not_found' }, 404);
  const session = await getDb(c.env.DB)
    .select({ isMock: bidSessions.isMock })
    .from(bidSessions)
    .where(eq(bidSessions.id, sessionId))
    .get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
  if (session.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
  return c.json({ error: 'canonical_live_command_required', command }, 409);
}

router.post(
  '/:id/force-pick',
  requireStepUpAuth(),
  requireLiveBidAction('force'),
  zValidator('json', ForcePickSchema),
  (c) => retiredSelectionMutation(c, 'live.force_selection'),
);
router.post(
  '/:id/skip',
  requireStepUpAuth(),
  requireLiveBidAction('skip_defer'),
  zValidator('json', SkipSchema),
  (c) => retiredSelectionMutation(c, 'live.disposition'),
);
router.post(
  '/:id/bid-for-member',
  requireStepUpAuth(),
  requireLiveBidAction('record_selection'),
  zValidator('json', BidForMemberSchema),
  (c) => retiredSelectionMutation(c, 'live.record_selection'),
);
router.post(
  '/:id/amend-selection',
  requireStepUpAuth(),
  requireLiveBidAction('amend_selection'),
  zValidator('json', AmendSelectionSchema),
  (c) => retiredSelectionMutation(c, 'live.amend_selection'),
);
// POST /api/admin/bid-session/:id/lock-position
router.post(
  '/:id/lock-position',
  requireStepUpAuth(),
  zValidator('json', LockPositionSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const body = c.req.valid('json');

    if (!isReasonValidForAction('lock_position', body.reason_code)) {
      return c.json(
        {
          error: 'invalid_reason_for_action',
          action: 'lock_position',
          reason_code: body.reason_code,
        },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
    if (session === undefined) return c.json({ error: 'session_not_found' }, 404);
    if (session.isMock) {
      return c.json({ error: 'mock_rehearsal_control_required' }, 409);
    }
    if (await requiresCanonicalBidMutation(c.env.DB, sessionId)) {
      return c.json({ error: 'canonical_mutation_requires_command' }, 409);
    }
    if (session.currentPhase !== 'config') {
      return c.json(
        { error: 'locks_only_in_config_phase', current_phase: session.currentPhase },
        409,
      );
    }

    const target = await resolveFrozenSessionBidTarget(db, {
      bidSessionId: sessionId,
      memberId: body.member_id,
      positionId: body.position_id,
    });
    if (!target.ok) {
      return c.json({ error: target.code }, frozenPolicyFailureStatus(target.code));
    }

    const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
      const current = await db
        .select()
        .from(bidSessions)
        .where(eq(bidSessions.id, sessionId))
        .get();
      if (current === undefined) return c.json({ error: 'session_not_found' }, 404);
      if (current.isMock) return c.json({ error: 'mock_rehearsal_control_required' }, 409);
      if (await requiresCanonicalBidMutation(c.env.DB, sessionId)) {
        return c.json({ error: 'canonical_mutation_requires_command' }, 409);
      }
      if (current.currentPhase !== 'config') {
        return c.json(
          { error: 'locks_only_in_config_phase', current_phase: current.currentPhase },
          409,
        );
      }
      const cfg: { position_locks?: { position_id: string; member_id: number }[] } =
        current.configJson !== null && current.configJson !== ''
          ? JSON.parse(current.configJson)
          : {};
      cfg.position_locks = Array.isArray(cfg.position_locks) ? cfg.position_locks : [];
      const conflict = cfg.position_locks.find((l) => l.position_id === body.position_id);
      if (conflict !== undefined) {
        return c.json({ error: 'position_already_locked', existing: conflict }, 409);
      }
      cfg.position_locks.push({ position_id: body.position_id, member_id: body.member_id });

      const claims = c.get('claims');
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE bid_sessions SET config_json = ? WHERE id = ? AND current_phase = ?',
        ).bind(JSON.stringify(cfg), sessionId, 'config'),
        auditInsertStatement(c.env.DB, {
          bidSessionId: sessionId,
          actorType: 'admin',
          actorId: claims.member_id,
          action: 'lock_position',
          targetKind: 'position',
          targetId: body.position_id,
          reason: body.reason,
          afterState: { member_id: body.member_id, reason_code: body.reason_code },
        }),
      ]);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return c.json({ error: 'position_lock_not_applied' }, 409);
      }

      return c.json({
        position_id: body.position_id,
        member_id: body.member_id,
        reason_code: body.reason_code,
      });
    });
    if (!mutation.ok) return c.json({ error: mutation.error }, 409);
    return mutation.value;
  },
);

export default router;
