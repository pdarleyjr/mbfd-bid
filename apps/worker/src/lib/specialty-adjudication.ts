/**
 * A pure, JSON-safe specialty-position interruption state machine.
 *
 * It deliberately owns no Durable Object, database, clock, or eligibility
 * engine dependency. The caller supplies an immutable, already-evaluated
 * policy snapshot and persists each accepted state/event transition atomically.
 * This keeps reconnect handling deterministic and prevents a later mutable
 * policy or roster read from changing an in-progress specialty decision.
 */

import {
  type SpecialtyTestOutcome,
  type SpecialtyTestPolicy,
  SpecialtyTestPolicySchema,
  isSpecialtyTestOutcomeAllowed,
} from './specialty-test-policy.js';

export type SpecialtyPolicySource = 'official' | 'synthetic';

export type SpecialtyEligibility =
  | { readonly status: 'eligible' }
  | { readonly status: 'ineligible'; readonly reasonCodes: readonly string[] };

/**
 * The decline/recall decision is intentionally configured rather than
 * inferred. Production callers must only construct a configured value from an
 * approved, frozen MBFD policy; tests may use a clearly synthetic value.
 */
export type SpecialtyCandidateReleasePolicy =
  | {
      readonly status: 'configured';
      readonly onRelease: 'continue_to_next_higher_priority' | 'return_to_original_bidder';
    }
  | { readonly status: 'unresolved'; readonly reason: string };

export interface SpecialtyPolicyCandidate {
  readonly memberId: number;
  /** Lower rank is higher specialty priority. Equal ranks are fail-closed. */
  readonly priorityRank: number;
  readonly generalEligibility: SpecialtyEligibility;
  readonly specialtyEligibility: SpecialtyEligibility;
}

export interface SpecialtyAdjudicationPolicy {
  /** Immutable rule-book/snapshot reference suitable for audit output. */
  readonly policyReference: string;
  readonly source: SpecialtyPolicySource;
  /** Required for synthetic rehearsal; never represents approved MBFD policy. */
  readonly testPolicy?: SpecialtyTestPolicy;
  readonly candidateReleasePolicy: SpecialtyCandidateReleasePolicy;
  /** Complete specialty ranking for the requested position, including requester. */
  readonly candidates: readonly SpecialtyPolicyCandidate[];
}

/** A stable locator for the normal Bid turn that was interrupted. */
export interface SpecialtyNormalTurn {
  readonly turnId: string;
  readonly bidderId: number;
  readonly ordinal: number;
  readonly queueCursor: number;
}

export interface SpecialtyAdjudicationRequest {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly requestId: string;
  readonly positionId: string;
  readonly normalTurn: SpecialtyNormalTurn;
  readonly policy: SpecialtyAdjudicationPolicy;
}

export type SpecialtyReleaseReason =
  | 'declined'
  | 'unreachable'
  | 'withdrawn'
  | 'ineligible_on_recheck';

/** The only candidate decisions supported by the engine. */
export type SpecialtyCandidateOutcome =
  | { readonly kind: 'award'; readonly awardReference: string }
  | { readonly kind: 'release'; readonly reason: SpecialtyReleaseReason };

export interface ResolveSpecialtyCandidateInput {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly requestId: string;
  readonly memberId: number;
  readonly outcome: SpecialtyCandidateOutcome;
}

export interface ResolveOriginalSpecialtyRequestInput {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly requestId: string;
  readonly outcome: SpecialtyCandidateOutcome;
}

export interface ResumeSpecialtyAdjudicationInput {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly requestId: string;
}

export interface SpecialtyCandidateSnapshot {
  readonly memberId: number;
  readonly priorityRank: number;
  readonly generalEligibility: SpecialtyEligibility;
  readonly specialtyEligibility: SpecialtyEligibility;
}

export interface SpecialtyCandidateOutcomeRecord {
  readonly memberId: number;
  readonly priorityRank: number;
  readonly outcome: SpecialtyCandidateOutcome;
}

export type SpecialtySeatResolution =
  | {
      readonly kind: 'awarded';
      readonly awardedToMemberId: number;
      readonly awardReference: string;
      readonly awardedBy: 'higher_priority_candidate' | 'original_bidder';
    }
  | {
      readonly kind: 'released';
      readonly releasedByMemberId: number;
      readonly reason: SpecialtyReleaseReason;
    };

export type SpecialtyAdjudicationPhase =
  | 'resolving_higher_priority_candidates'
  | 'awaiting_original_bidder'
  | 'awaiting_resume';

/**
 * Active state is all primitives, arrays, and plain objects so JSON
 * serialization is a valid reconnect format (no Map, Set, Date, or function).
 */
export interface ActiveSpecialtyAdjudication {
  readonly requestId: string;
  readonly positionId: string;
  readonly policyReference: string;
  readonly policySource: SpecialtyPolicySource;
  readonly testPolicy: SpecialtyTestPolicy | null;
  readonly candidateReleasePolicy: Extract<
    SpecialtyCandidateReleasePolicy,
    { readonly status: 'configured' }
  >;
  readonly originalTurn: SpecialtyNormalTurn;
  /** All supplied candidates, sorted deterministically by priority rank. */
  readonly rankedCandidates: readonly SpecialtyCandidateSnapshot[];
  /** Only eligible candidates with superior specialty priority. */
  readonly candidateQueue: readonly SpecialtyCandidateSnapshot[];
  /** Index of the only candidate eligible for the next resolution command. */
  readonly candidateCursor: number;
  readonly candidateOutcomes: readonly SpecialtyCandidateOutcomeRecord[];
  readonly phase: SpecialtyAdjudicationPhase;
  readonly resolution: SpecialtySeatResolution | null;
}

export interface SpecialtyAdjudicationState {
  readonly version: 1;
  /** Optimistic concurrency revision; every accepted command increments it. */
  readonly revision: number;
  readonly active: ActiveSpecialtyAdjudication | null;
  /** Accepted command IDs, retained to reject duplicate reconnect commands. */
  readonly consumedCommandIds: readonly string[];
  /** Requests that have already been evaluated, including no-interruption requests. */
  readonly processedRequestIds: readonly string[];
  /** Requests whose exact suspended normal turn has already been returned once. */
  readonly resumedRequestIds: readonly string[];
}

export interface SpecialtyAuditBase {
  readonly commandId: string;
  readonly requestId: string;
  readonly positionId: string;
  readonly policyReference: string;
  readonly policySource: SpecialtyPolicySource;
  readonly testPolicyVersion: string | null;
  readonly adjudicationRevision: number;
}

export type SpecialtyAuditEvent =
  | {
      readonly type: 'specialty_turn_suspended';
      readonly payload: SpecialtyAuditBase & {
        readonly reason: 'higher_priority_eligible_candidates';
        readonly originalTurn: SpecialtyNormalTurn;
        readonly originalPriorityRank: number;
        readonly candidateRanking: readonly SpecialtyCandidateSnapshot[];
        readonly higherPriorityCandidateIds: readonly number[];
      };
    }
  | {
      readonly type: 'specialty_request_no_interruption';
      readonly payload: SpecialtyAuditBase & {
        readonly originalTurn: SpecialtyNormalTurn;
        readonly originalPriorityRank: number;
        readonly candidateRanking: readonly SpecialtyCandidateSnapshot[];
        readonly higherPriorityCandidateIds: readonly number[];
      };
    }
  | {
      readonly type: 'specialty_candidate_resolved';
      readonly payload: SpecialtyAuditBase & {
        readonly memberId: number;
        readonly priorityRank: number;
        readonly outcome: SpecialtyCandidateOutcome;
        readonly nextCandidateId: number | null;
      };
    }
  | {
      readonly type: 'specialty_original_request_ready';
      readonly payload: SpecialtyAuditBase & {
        readonly originalTurn: SpecialtyNormalTurn;
        readonly reason: 'higher_priority_candidates_released' | 'configured_release_to_original';
      };
    }
  | {
      readonly type: 'specialty_original_request_resolved';
      readonly payload: SpecialtyAuditBase & {
        readonly originalTurn: SpecialtyNormalTurn;
        readonly outcome: SpecialtyCandidateOutcome;
      };
    }
  | {
      readonly type: 'specialty_position_awarded';
      readonly payload: SpecialtyAuditBase & {
        readonly resolution: Extract<SpecialtySeatResolution, { kind: 'awarded' }>;
      };
    }
  | {
      readonly type: 'specialty_position_released';
      readonly payload: SpecialtyAuditBase & {
        readonly resolution: Extract<SpecialtySeatResolution, { kind: 'released' }>;
      };
    }
  | {
      readonly type: 'specialty_turn_resumed';
      readonly payload: SpecialtyAuditBase & {
        readonly originalTurn: SpecialtyNormalTurn;
        readonly resolution: SpecialtySeatResolution;
      };
    };

export type SpecialtyAdjudicationRejectCode =
  | 'INVALID_STATE'
  | 'INVALID_COMMAND'
  | 'STALE_REVISION'
  | 'DUPLICATE_COMMAND'
  | 'DUPLICATE_REQUEST'
  | 'ADJUDICATION_ALREADY_ACTIVE'
  | 'INVALID_REQUEST'
  | 'INVALID_POLICY'
  | 'UNRESOLVED_OFFICIAL_POLICY'
  | 'AMBIGUOUS_SPECIALTY_PRIORITY'
  | 'ORIGINAL_CANDIDATE_MISSING'
  | 'ORIGINAL_GENERAL_INELIGIBLE'
  | 'ORIGINAL_SPECIALTY_INELIGIBLE'
  | 'NO_ACTIVE_ADJUDICATION'
  | 'REQUEST_ID_MISMATCH'
  | 'OUT_OF_ORDER_CANDIDATE'
  | 'CANDIDATE_ALREADY_RESOLVED'
  | 'CANDIDATES_ALREADY_RESOLVED'
  | 'ORIGINAL_RESOLUTION_NOT_READY'
  | 'ADJUDICATION_NOT_RESOLVED'
  | 'ALREADY_RESUMED'
  | 'INVALID_OUTCOME';

export interface SpecialtyAdjudicationRejected {
  readonly kind: 'rejected';
  readonly code: SpecialtyAdjudicationRejectCode;
  readonly message: string;
  readonly state: SpecialtyAdjudicationState;
  readonly events: readonly [];
}

export type BeginSpecialtyAdjudicationResult =
  | {
      readonly kind: 'suspended';
      readonly state: SpecialtyAdjudicationState;
      readonly events: readonly [SpecialtyAuditEvent];
    }
  | {
      readonly kind: 'not_required';
      readonly state: SpecialtyAdjudicationState;
      readonly events: readonly [SpecialtyAuditEvent];
    }
  | SpecialtyAdjudicationRejected;

export type ResolveSpecialtyCandidateResult =
  | {
      readonly kind: 'candidate_resolved';
      readonly state: SpecialtyAdjudicationState;
      readonly events: readonly SpecialtyAuditEvent[];
    }
  | SpecialtyAdjudicationRejected;

export type ResolveOriginalSpecialtyRequestResult =
  | {
      readonly kind: 'original_resolved';
      readonly state: SpecialtyAdjudicationState;
      readonly events: readonly [SpecialtyAuditEvent, SpecialtyAuditEvent];
    }
  | SpecialtyAdjudicationRejected;

export type ResumeSpecialtyAdjudicationResult =
  | {
      readonly kind: 'resumed';
      readonly state: SpecialtyAdjudicationState;
      readonly normalTurn: SpecialtyNormalTurn;
      readonly resolution: SpecialtySeatResolution;
      readonly events: readonly [SpecialtyAuditEvent];
    }
  | SpecialtyAdjudicationRejected;

export function createSpecialtyAdjudicationState(): SpecialtyAdjudicationState {
  return {
    version: 1,
    revision: 0,
    active: null,
    consumedCommandIds: [],
    processedRequestIds: [],
    resumedRequestIds: [],
  };
}

/** Safe public guard for callers that must inspect persisted DO state before writing. */
export function isValidSpecialtyAdjudicationState(
  value: unknown,
): value is SpecialtyAdjudicationState {
  return isPersistedState(value);
}

/**
 * Evaluates a normal bidder's specialty request against a frozen candidate
 * policy. It suspends only when a generally and specially eligible candidate
 * has a strictly superior, unambiguous specialty priority rank.
 */
export function beginSpecialtyAdjudication(
  state: SpecialtyAdjudicationState,
  input: SpecialtyAdjudicationRequest,
): BeginSpecialtyAdjudicationResult {
  const preflight = preflightCommand(state, input);
  if (preflight !== null) return rejected(state, preflight);
  if (!isValidBeginInput(input)) return rejected(state, 'INVALID_REQUEST');
  if (state.processedRequestIds.includes(input.requestId))
    return rejected(state, 'DUPLICATE_REQUEST');
  if (state.active !== null) return rejected(state, 'ADJUDICATION_ALREADY_ACTIVE');

  const policy = validatePolicy(input.policy, input.normalTurn);
  if (!policy.ok) return rejected(state, policy.code);

  const nextRevision = state.revision + 1;
  const base = acceptedBase(state, input.commandId, input.requestId, nextRevision);
  const auditBase = makeAuditBase(input, nextRevision);
  const higherPriorityCandidateIds = policy.higherPriorityCandidates.map(
    (candidate) => candidate.memberId,
  );
  if (policy.higherPriorityCandidates.length === 0) {
    return {
      kind: 'not_required',
      state: base,
      events: [
        {
          type: 'specialty_request_no_interruption',
          payload: {
            ...auditBase,
            originalTurn: cloneNormalTurn(input.normalTurn),
            originalPriorityRank: policy.originalCandidate.priorityRank,
            candidateRanking: cloneCandidates(policy.rankedCandidates),
            higherPriorityCandidateIds,
          },
        },
      ],
    };
  }

  const active: ActiveSpecialtyAdjudication = {
    requestId: input.requestId,
    positionId: input.positionId,
    policyReference: input.policy.policyReference,
    policySource: input.policy.source,
    testPolicy: policy.testPolicy,
    candidateReleasePolicy: policy.candidateReleasePolicy,
    originalTurn: cloneNormalTurn(input.normalTurn),
    rankedCandidates: cloneCandidates(policy.rankedCandidates),
    candidateQueue: cloneCandidates(policy.higherPriorityCandidates),
    candidateCursor: 0,
    candidateOutcomes: [],
    phase: 'resolving_higher_priority_candidates',
    resolution: null,
  };
  const nextState: SpecialtyAdjudicationState = { ...base, active };
  return {
    kind: 'suspended',
    state: nextState,
    events: [
      {
        type: 'specialty_turn_suspended',
        payload: {
          ...auditBase,
          reason: 'higher_priority_eligible_candidates',
          originalTurn: cloneNormalTurn(input.normalTurn),
          originalPriorityRank: policy.originalCandidate.priorityRank,
          candidateRanking: cloneCandidates(policy.rankedCandidates),
          higherPriorityCandidateIds,
        },
      },
    ],
  };
}

/**
 * Resolves precisely the next higher-priority candidate. A candidate can only
 * award the specialty seat to themself or release it through a typed reason.
 */
export function resolveSpecialtyCandidate(
  state: SpecialtyAdjudicationState,
  input: ResolveSpecialtyCandidateInput,
): ResolveSpecialtyCandidateResult {
  const preflight = preflightCommand(state, input);
  if (preflight !== null) return rejected(state, preflight);
  if (!isValidCandidateResolutionInput(input)) return rejected(state, 'INVALID_COMMAND');

  const active = state.active;
  if (active === null) return rejectedForMissingActive(state, input.requestId);
  if (active.requestId !== input.requestId) return rejected(state, 'REQUEST_ID_MISMATCH');
  if (active.phase === 'awaiting_original_bidder')
    return rejected(state, 'CANDIDATES_ALREADY_RESOLVED');
  if (active.phase === 'awaiting_resume') return rejected(state, 'CANDIDATES_ALREADY_RESOLVED');
  if (!isOutcomeAllowedForActivePolicy(active, input.outcome)) {
    return rejected(state, 'INVALID_OUTCOME');
  }

  const expectedCandidate = active.candidateQueue[active.candidateCursor];
  if (expectedCandidate === undefined) return rejected(state, 'INVALID_STATE');
  if (expectedCandidate.memberId !== input.memberId) {
    if (active.candidateOutcomes.some((outcome) => outcome.memberId === input.memberId)) {
      return rejected(state, 'CANDIDATE_ALREADY_RESOLVED');
    }
    return rejected(state, 'OUT_OF_ORDER_CANDIDATE');
  }

  const outcome = cloneOutcome(input.outcome);
  const outcomeRecord: SpecialtyCandidateOutcomeRecord = {
    memberId: expectedCandidate.memberId,
    priorityRank: expectedCandidate.priorityRank,
    outcome,
  };
  const nextRevision = state.revision + 1;
  const base = acceptedBase(state, input.commandId, undefined, nextRevision);
  const auditBase = makeActiveAuditBase(active, nextRevision, input.commandId);
  const candidateOutcomes = [...active.candidateOutcomes, outcomeRecord];

  if (outcome.kind === 'award') {
    const resolution: SpecialtySeatResolution = {
      kind: 'awarded',
      awardedToMemberId: expectedCandidate.memberId,
      awardReference: outcome.awardReference,
      awardedBy: 'higher_priority_candidate',
    };
    const nextActive: ActiveSpecialtyAdjudication = {
      ...active,
      candidateOutcomes,
      candidateCursor: active.candidateCursor + 1,
      phase: 'awaiting_resume',
      resolution,
    };
    return {
      kind: 'candidate_resolved',
      state: { ...base, active: nextActive },
      events: [
        candidateResolvedEvent(auditBase, expectedCandidate, outcome, null),
        positionResolutionEvent(auditBase, resolution),
      ],
    };
  }

  const nextCursor = active.candidateCursor + 1;
  const releaseReturnsToOriginal =
    active.candidateReleasePolicy.onRelease === 'return_to_original_bidder';
  const candidatesExhausted = nextCursor >= active.candidateQueue.length;
  if (releaseReturnsToOriginal || candidatesExhausted) {
    const nextActive: ActiveSpecialtyAdjudication = {
      ...active,
      candidateOutcomes,
      candidateCursor: nextCursor,
      phase: 'awaiting_original_bidder',
      resolution: null,
    };
    return {
      kind: 'candidate_resolved',
      state: { ...base, active: nextActive },
      events: [
        candidateResolvedEvent(auditBase, expectedCandidate, outcome, null),
        {
          type: 'specialty_original_request_ready',
          payload: {
            ...auditBase,
            originalTurn: cloneNormalTurn(active.originalTurn),
            reason: releaseReturnsToOriginal
              ? 'configured_release_to_original'
              : 'higher_priority_candidates_released',
          },
        },
      ],
    };
  }

  const nextCandidate = active.candidateQueue[nextCursor];
  if (nextCandidate === undefined) return rejected(state, 'INVALID_STATE');
  const nextActive: ActiveSpecialtyAdjudication = {
    ...active,
    candidateOutcomes,
    candidateCursor: nextCursor,
  };
  return {
    kind: 'candidate_resolved',
    state: { ...base, active: nextActive },
    events: [candidateResolvedEvent(auditBase, expectedCandidate, outcome, nextCandidate.memberId)],
  };
}

/**
 * Once the configured higher-priority flow has released the position, resolve
 * the original bidder's request explicitly. This is separate from resume so
 * the outer Bid engine can persist the award/release before restoring the
 * interrupted normal turn.
 */
export function resolveOriginalSpecialtyRequest(
  state: SpecialtyAdjudicationState,
  input: ResolveOriginalSpecialtyRequestInput,
): ResolveOriginalSpecialtyRequestResult {
  const preflight = preflightCommand(state, input);
  if (preflight !== null) return rejected(state, preflight);
  if (!isValidOriginalResolutionInput(input)) return rejected(state, 'INVALID_COMMAND');

  const active = state.active;
  if (active === null) return rejectedForMissingActive(state, input.requestId);
  if (active.requestId !== input.requestId) return rejected(state, 'REQUEST_ID_MISMATCH');
  if (active.phase !== 'awaiting_original_bidder')
    return rejected(state, 'ORIGINAL_RESOLUTION_NOT_READY');
  if (!isOutcomeAllowedForActivePolicy(active, input.outcome)) {
    return rejected(state, 'INVALID_OUTCOME');
  }

  const outcome = cloneOutcome(input.outcome);
  const resolution: SpecialtySeatResolution =
    outcome.kind === 'award'
      ? {
          kind: 'awarded',
          awardedToMemberId: active.originalTurn.bidderId,
          awardReference: outcome.awardReference,
          awardedBy: 'original_bidder',
        }
      : {
          kind: 'released',
          releasedByMemberId: active.originalTurn.bidderId,
          reason: outcome.reason,
        };
  const nextRevision = state.revision + 1;
  const base = acceptedBase(state, input.commandId, undefined, nextRevision);
  const auditBase = makeActiveAuditBase(active, nextRevision, input.commandId);
  const nextActive: ActiveSpecialtyAdjudication = {
    ...active,
    phase: 'awaiting_resume',
    resolution,
  };
  return {
    kind: 'original_resolved',
    state: { ...base, active: nextActive },
    events: [
      {
        type: 'specialty_original_request_resolved',
        payload: {
          ...auditBase,
          originalTurn: cloneNormalTurn(active.originalTurn),
          outcome,
        },
      },
      positionResolutionEvent(auditBase, resolution),
    ],
  };
}

/**
 * Returns the exact frozen normal turn exactly once. The integration owner
 * should atomically persist this state and its audit event before allowing the
 * normal Bid state machine to accept another command for that bidder.
 */
export function resumeSpecialtyAdjudication(
  state: SpecialtyAdjudicationState,
  input: ResumeSpecialtyAdjudicationInput,
): ResumeSpecialtyAdjudicationResult {
  const preflight = preflightCommand(state, input);
  if (preflight !== null) return rejected(state, preflight);
  if (!isValidResumeInput(input)) return rejected(state, 'INVALID_COMMAND');

  const active = state.active;
  if (active === null) return rejectedForMissingActive(state, input.requestId);
  if (active.requestId !== input.requestId) return rejected(state, 'REQUEST_ID_MISMATCH');
  if (active.phase !== 'awaiting_resume' || active.resolution === null) {
    return rejected(state, 'ADJUDICATION_NOT_RESOLVED');
  }

  const nextRevision = state.revision + 1;
  const base = acceptedBase(state, input.commandId, undefined, nextRevision);
  const normalTurn = cloneNormalTurn(active.originalTurn);
  const resolution = cloneResolution(active.resolution);
  const nextState: SpecialtyAdjudicationState = {
    ...base,
    active: null,
    resumedRequestIds: [...base.resumedRequestIds, active.requestId],
  };
  return {
    kind: 'resumed',
    state: nextState,
    normalTurn,
    resolution,
    events: [
      {
        type: 'specialty_turn_resumed',
        payload: {
          ...makeActiveAuditBase(active, nextRevision, input.commandId),
          originalTurn: normalTurn,
          resolution,
        },
      },
    ],
  };
}

function acceptedBase(
  state: SpecialtyAdjudicationState,
  commandId: string,
  requestId: string | undefined,
  revision: number,
): SpecialtyAdjudicationState {
  return {
    ...state,
    revision,
    consumedCommandIds: [...state.consumedCommandIds, commandId],
    ...(requestId === undefined
      ? {}
      : { processedRequestIds: [...state.processedRequestIds, requestId] }),
  };
}

function preflightCommand(
  state: SpecialtyAdjudicationState,
  input: { readonly commandId: string; readonly expectedRevision: number },
): SpecialtyAdjudicationRejectCode | null {
  if (!isPersistedState(state)) return 'INVALID_STATE';
  if (!isCommandEnvelope(input)) return 'INVALID_COMMAND';
  if (state.consumedCommandIds.includes(input.commandId)) return 'DUPLICATE_COMMAND';
  if (state.revision !== input.expectedRevision) return 'STALE_REVISION';
  return null;
}

function rejected(
  state: SpecialtyAdjudicationState,
  code: SpecialtyAdjudicationRejectCode,
): SpecialtyAdjudicationRejected {
  return { kind: 'rejected', code, message: rejectionMessage(code), state, events: [] };
}

function rejectedForMissingActive(
  state: SpecialtyAdjudicationState,
  requestId: string,
): SpecialtyAdjudicationRejected {
  return rejected(
    state,
    state.resumedRequestIds.includes(requestId) ? 'ALREADY_RESUMED' : 'NO_ACTIVE_ADJUDICATION',
  );
}

function validatePolicy(
  policy: SpecialtyAdjudicationPolicy,
  originalTurn: SpecialtyNormalTurn,
):
  | {
      readonly ok: true;
      readonly candidateReleasePolicy: Extract<
        SpecialtyCandidateReleasePolicy,
        { readonly status: 'configured' }
      >;
      readonly testPolicy: SpecialtyTestPolicy | null;
      readonly rankedCandidates: readonly SpecialtyCandidateSnapshot[];
      readonly originalCandidate: SpecialtyCandidateSnapshot;
      readonly higherPriorityCandidates: readonly SpecialtyCandidateSnapshot[];
    }
  | { readonly ok: false; readonly code: SpecialtyAdjudicationRejectCode } {
  if (!isPolicyEnvelope(policy)) return { ok: false, code: 'INVALID_POLICY' };
  // No official specialty semantics are approved. Keep the engine's only
  // operational path explicitly synthetic until a policy owner supplies one.
  if (policy.source === 'official') {
    return { ok: false, code: 'UNRESOLVED_OFFICIAL_POLICY' };
  }
  const parsedTestPolicy =
    policy.source === 'synthetic' ? SpecialtyTestPolicySchema.safeParse(policy.testPolicy) : null;
  if (policy.source === 'synthetic' && !parsedTestPolicy?.success) {
    return { ok: false, code: 'INVALID_POLICY' };
  }
  if (policy.candidateReleasePolicy.status === 'unresolved') {
    // This code is intentionally used for both source labels: neither a
    // synthetic fixture nor an official request may operate without an
    // explicit policy behavior.
    return { ok: false, code: 'UNRESOLVED_OFFICIAL_POLICY' };
  }

  const candidateIds = new Set<number>();
  const priorityRanks = new Set<number>();
  const candidates: SpecialtyCandidateSnapshot[] = [];
  for (const candidate of policy.candidates) {
    if (!isPolicyCandidate(candidate)) return { ok: false, code: 'INVALID_POLICY' };
    if (candidateIds.has(candidate.memberId)) return { ok: false, code: 'INVALID_POLICY' };
    if (priorityRanks.has(candidate.priorityRank)) {
      return { ok: false, code: 'AMBIGUOUS_SPECIALTY_PRIORITY' };
    }
    candidateIds.add(candidate.memberId);
    priorityRanks.add(candidate.priorityRank);
    candidates.push(cloneCandidate(candidate));
  }
  if (candidates.length === 0) return { ok: false, code: 'INVALID_POLICY' };

  const rankedCandidates = candidates.sort((left, right) => left.priorityRank - right.priorityRank);
  const originalCandidate = rankedCandidates.find(
    (candidate) => candidate.memberId === originalTurn.bidderId,
  );
  if (originalCandidate === undefined) return { ok: false, code: 'ORIGINAL_CANDIDATE_MISSING' };
  if (originalCandidate.generalEligibility.status !== 'eligible') {
    return { ok: false, code: 'ORIGINAL_GENERAL_INELIGIBLE' };
  }
  if (originalCandidate.specialtyEligibility.status !== 'eligible') {
    return { ok: false, code: 'ORIGINAL_SPECIALTY_INELIGIBLE' };
  }

  const higherPriorityCandidates = rankedCandidates.filter(
    (candidate) =>
      candidate.priorityRank < originalCandidate.priorityRank &&
      candidate.generalEligibility.status === 'eligible' &&
      candidate.specialtyEligibility.status === 'eligible',
  );
  return {
    ok: true,
    candidateReleasePolicy: {
      status: 'configured',
      onRelease: policy.candidateReleasePolicy.onRelease,
    },
    testPolicy: parsedTestPolicy?.success ? cloneTestPolicy(parsedTestPolicy.data) : null,
    rankedCandidates,
    originalCandidate,
    higherPriorityCandidates,
  };
}

function candidateResolvedEvent(
  auditBase: SpecialtyAuditBase,
  candidate: SpecialtyCandidateSnapshot,
  outcome: SpecialtyCandidateOutcome,
  nextCandidateId: number | null,
): SpecialtyAuditEvent {
  return {
    type: 'specialty_candidate_resolved',
    payload: {
      ...auditBase,
      memberId: candidate.memberId,
      priorityRank: candidate.priorityRank,
      outcome: cloneOutcome(outcome),
      nextCandidateId,
    },
  };
}

function positionResolutionEvent(
  auditBase: SpecialtyAuditBase,
  resolution: SpecialtySeatResolution,
): SpecialtyAuditEvent {
  if (resolution.kind === 'awarded') {
    const awardedResolution: Extract<SpecialtySeatResolution, { kind: 'awarded' }> = {
      kind: 'awarded',
      awardedToMemberId: resolution.awardedToMemberId,
      awardReference: resolution.awardReference,
      awardedBy: resolution.awardedBy,
    };
    return {
      type: 'specialty_position_awarded',
      payload: { ...auditBase, resolution: awardedResolution },
    };
  }
  const releasedResolution: Extract<SpecialtySeatResolution, { kind: 'released' }> = {
    kind: 'released',
    releasedByMemberId: resolution.releasedByMemberId,
    reason: resolution.reason,
  };
  return {
    type: 'specialty_position_released',
    payload: { ...auditBase, resolution: releasedResolution },
  };
}

function makeAuditBase(input: SpecialtyAdjudicationRequest, revision: number): SpecialtyAuditBase {
  return {
    commandId: input.commandId,
    requestId: input.requestId,
    positionId: input.positionId,
    policyReference: input.policy.policyReference,
    policySource: input.policy.source,
    testPolicyVersion:
      input.policy.source === 'synthetic' && input.policy.testPolicy !== undefined
        ? input.policy.testPolicy.policy_version
        : null,
    adjudicationRevision: revision,
  };
}

function makeActiveAuditBase(
  active: ActiveSpecialtyAdjudication,
  revision: number,
  commandId: string,
): SpecialtyAuditBase {
  return {
    commandId,
    requestId: active.requestId,
    positionId: active.positionId,
    policyReference: active.policyReference,
    policySource: active.policySource,
    testPolicyVersion: active.testPolicy?.policy_version ?? null,
    adjudicationRevision: revision,
  };
}

function cloneTestPolicy(policy: SpecialtyTestPolicy): SpecialtyTestPolicy {
  return {
    policy_label: policy.policy_label,
    policy_version: policy.policy_version,
    specialty_pool: {
      id: policy.specialty_pool.id,
      label: policy.specialty_pool.label,
    },
    qualification_requirements: Array.isArray(policy.qualification_requirements)
      ? [...policy.qualification_requirements]
      : {
          v: policy.qualification_requirements.v,
          credential_names: [...policy.qualification_requirements.credential_names],
          specialty_codes: [...policy.qualification_requirements.specialty_codes],
        },
    ranking: {
      source: policy.ranking.source,
      reference: policy.ranking.reference,
    },
    scoring: {
      source: policy.scoring.source,
      direction: policy.scoring.direction,
    },
    tie_break_chain: [...policy.tie_break_chain],
    normal_bid_interruption: policy.normal_bid_interruption,
    candidate_outcomes: [...policy.candidate_outcomes],
    original_bidder_resume: policy.original_bidder_resume,
  };
}

function cloneNormalTurn(turn: SpecialtyNormalTurn): SpecialtyNormalTurn {
  return {
    turnId: turn.turnId,
    bidderId: turn.bidderId,
    ordinal: turn.ordinal,
    queueCursor: turn.queueCursor,
  };
}

function cloneEligibility(eligibility: SpecialtyEligibility): SpecialtyEligibility {
  return eligibility.status === 'eligible'
    ? { status: 'eligible' }
    : { status: 'ineligible', reasonCodes: [...eligibility.reasonCodes] };
}

function cloneCandidate(
  candidate: SpecialtyPolicyCandidate | SpecialtyCandidateSnapshot,
): SpecialtyCandidateSnapshot {
  return {
    memberId: candidate.memberId,
    priorityRank: candidate.priorityRank,
    generalEligibility: cloneEligibility(candidate.generalEligibility),
    specialtyEligibility: cloneEligibility(candidate.specialtyEligibility),
  };
}

function cloneCandidates(
  candidates: readonly (SpecialtyPolicyCandidate | SpecialtyCandidateSnapshot)[],
): SpecialtyCandidateSnapshot[] {
  return candidates.map((candidate) => cloneCandidate(candidate));
}

function cloneOutcome(outcome: SpecialtyCandidateOutcome): SpecialtyCandidateOutcome {
  return outcome.kind === 'award'
    ? { kind: 'award', awardReference: outcome.awardReference }
    : { kind: 'release', reason: outcome.reason };
}

function cloneResolution(resolution: SpecialtySeatResolution): SpecialtySeatResolution {
  return resolution.kind === 'awarded'
    ? {
        kind: 'awarded',
        awardedToMemberId: resolution.awardedToMemberId,
        awardReference: resolution.awardReference,
        awardedBy: resolution.awardedBy,
      }
    : {
        kind: 'released',
        releasedByMemberId: resolution.releasedByMemberId,
        reason: resolution.reason,
      };
}

function isValidBeginInput(input: SpecialtyAdjudicationRequest): boolean {
  return (
    isOpaqueId(input.requestId) &&
    isOpaqueId(input.positionId) &&
    isNormalTurn(input.normalTurn) &&
    isPolicyEnvelope(input.policy)
  );
}

function isValidCandidateResolutionInput(input: ResolveSpecialtyCandidateInput): boolean {
  return isOpaqueId(input.requestId) && isMemberId(input.memberId) && isOutcome(input.outcome);
}

function isValidOriginalResolutionInput(input: ResolveOriginalSpecialtyRequestInput): boolean {
  return isOpaqueId(input.requestId) && isOutcome(input.outcome);
}

function isValidResumeInput(input: ResumeSpecialtyAdjudicationInput): boolean {
  return isOpaqueId(input.requestId);
}

function isCommandEnvelope(input: {
  readonly commandId: unknown;
  readonly expectedRevision: unknown;
}): input is { readonly commandId: string; readonly expectedRevision: number } {
  return isOpaqueId(input.commandId) && isNonNegativeInteger(input.expectedRevision);
}

function isPolicyEnvelope(value: unknown): value is SpecialtyAdjudicationPolicy {
  if (!isRecord(value)) return false;
  return (
    isOpaqueId(value.policyReference) &&
    (value.source === 'official' || value.source === 'synthetic') &&
    isReleasePolicy(value.candidateReleasePolicy) &&
    Array.isArray(value.candidates)
  );
}

function isReleasePolicy(value: unknown): value is SpecialtyCandidateReleasePolicy {
  if (!isRecord(value)) return false;
  if (value.status === 'unresolved') return isOpaqueId(value.reason);
  return (
    value.status === 'configured' &&
    (value.onRelease === 'continue_to_next_higher_priority' ||
      value.onRelease === 'return_to_original_bidder')
  );
}

function isPolicyCandidate(value: unknown): value is SpecialtyPolicyCandidate {
  if (!isRecord(value)) return false;
  return (
    isMemberId(value.memberId) &&
    isNonNegativeInteger(value.priorityRank) &&
    isEligibility(value.generalEligibility) &&
    isEligibility(value.specialtyEligibility)
  );
}

function isEligibility(value: unknown): value is SpecialtyEligibility {
  if (!isRecord(value)) return false;
  if (value.status === 'eligible') return true;
  return (
    value.status === 'ineligible' &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.length > 0 &&
    value.reasonCodes.every((reason) => isOpaqueId(reason))
  );
}

function isOutcome(value: unknown): value is SpecialtyCandidateOutcome {
  if (!isRecord(value)) return false;
  if (value.kind === 'award') return isOpaqueId(value.awardReference);
  return (
    value.kind === 'release' &&
    (value.reason === 'declined' ||
      value.reason === 'unreachable' ||
      value.reason === 'withdrawn' ||
      value.reason === 'ineligible_on_recheck')
  );
}

function isOutcomeAllowedForActivePolicy(
  active: ActiveSpecialtyAdjudication,
  outcome: SpecialtyCandidateOutcome,
): boolean {
  if (active.policySource !== 'synthetic' || active.testPolicy === null) return false;
  const policyOutcome: SpecialtyTestOutcome = outcome.kind === 'award' ? 'award' : outcome.reason;
  return isSpecialtyTestOutcomeAllowed(active.testPolicy, policyOutcome);
}

function isNormalTurn(value: unknown): value is SpecialtyNormalTurn {
  if (!isRecord(value)) return false;
  return (
    isOpaqueId(value.turnId) &&
    isMemberId(value.bidderId) &&
    isPositiveInteger(value.ordinal) &&
    isNonNegativeInteger(value.queueCursor)
  );
}

function isPersistedState(value: unknown): value is SpecialtyAdjudicationState {
  if (!isRecord(value)) return false;
  const { version, revision, active } = value;
  const consumedCommandIds = value.consumedCommandIds;
  const processedRequestIds = value.processedRequestIds;
  const resumedRequestIds = value.resumedRequestIds;
  if (version !== 1 || !isNonNegativeInteger(revision)) return false;
  if (!isUniqueOpaqueIdArray(consumedCommandIds)) return false;
  if (!isUniqueOpaqueIdArray(processedRequestIds)) return false;
  if (!isUniqueOpaqueIdArray(resumedRequestIds)) return false;
  if (consumedCommandIds.length !== revision) return false;
  if (!resumedRequestIds.every((requestId) => processedRequestIds.includes(requestId))) {
    return false;
  }
  if (active === null) return true;
  return (
    isActiveAdjudication(active) &&
    processedRequestIds.includes(active.requestId) &&
    !resumedRequestIds.includes(active.requestId)
  );
}

function isActiveAdjudication(value: unknown): value is ActiveSpecialtyAdjudication {
  if (!isRecord(value)) return false;
  const originalTurn = value.originalTurn;
  const rankedCandidates = value.rankedCandidates;
  const candidateQueue = value.candidateQueue;
  const candidateOutcomes = value.candidateOutcomes;
  const candidateCursor = value.candidateCursor;
  const syntheticTestPolicy =
    value.policySource === 'synthetic'
      ? SpecialtyTestPolicySchema.safeParse(value.testPolicy)
      : null;
  if (
    !isOpaqueId(value.requestId) ||
    !isOpaqueId(value.positionId) ||
    !isOpaqueId(value.policyReference) ||
    (value.policySource !== 'official' && value.policySource !== 'synthetic') ||
    !isReleasePolicy(value.candidateReleasePolicy) ||
    value.candidateReleasePolicy.status !== 'configured' ||
    !isNormalTurn(originalTurn) ||
    !Array.isArray(rankedCandidates) ||
    !Array.isArray(candidateQueue) ||
    !Array.isArray(candidateOutcomes) ||
    !isNonNegativeInteger(candidateCursor)
  ) {
    return false;
  }
  if (value.policySource !== 'synthetic') return false;
  if (value.policySource === 'synthetic' && !syntheticTestPolicy?.success) return false;
  if (!rankedCandidates.every((candidate) => isPolicyCandidate(candidate))) return false;
  if (!candidateQueue.every((candidate) => isPolicyCandidate(candidate))) return false;
  if (!candidateOutcomes.every((outcome) => isCandidateOutcomeRecord(outcome))) return false;
  if (!hasUniqueCandidateIdentityAndPriority(rankedCandidates)) return false;
  if (!isStrictPriorityOrder(rankedCandidates)) return false;
  if (candidateQueue.length === 0 || !isStrictPriorityOrder(candidateQueue)) return false;
  if (candidateCursor > candidateQueue.length || candidateOutcomes.length !== candidateCursor) {
    return false;
  }

  const originalCandidate = rankedCandidates.find(
    (candidate) => candidate.memberId === originalTurn.bidderId,
  );
  if (
    originalCandidate === undefined ||
    originalCandidate.generalEligibility.status !== 'eligible' ||
    originalCandidate.specialtyEligibility.status !== 'eligible'
  ) {
    return false;
  }
  for (const candidate of candidateQueue) {
    const ranked = rankedCandidates.find((entry) => entry.memberId === candidate.memberId);
    if (
      ranked === undefined ||
      !sameCandidate(ranked, candidate) ||
      candidate.priorityRank >= originalCandidate.priorityRank ||
      candidate.generalEligibility.status !== 'eligible' ||
      candidate.specialtyEligibility.status !== 'eligible'
    ) {
      return false;
    }
  }
  for (const [index, outcome] of candidateOutcomes.entries()) {
    const candidate = candidateQueue[index];
    if (
      candidate === undefined ||
      outcome.memberId !== candidate.memberId ||
      outcome.priorityRank !== candidate.priorityRank
    ) {
      return false;
    }
  }
  if (!isAdjudicationPhase(value.phase)) return false;
  if (value.phase === 'resolving_higher_priority_candidates') {
    return candidateCursor < candidateQueue.length && value.resolution === null;
  }
  if (value.phase === 'awaiting_original_bidder') {
    return candidateCursor >= 1 && value.resolution === null;
  }
  return candidateCursor >= 1 && isSeatResolution(value.resolution);
}

function isCandidateOutcomeRecord(value: unknown): value is SpecialtyCandidateOutcomeRecord {
  if (!isRecord(value)) return false;
  return (
    isMemberId(value.memberId) &&
    isNonNegativeInteger(value.priorityRank) &&
    isOutcome(value.outcome)
  );
}

function hasUniqueCandidateIdentityAndPriority(
  candidates: readonly SpecialtyPolicyCandidate[],
): boolean {
  const memberIds = new Set<number>();
  const priorityRanks = new Set<number>();
  for (const candidate of candidates) {
    if (memberIds.has(candidate.memberId) || priorityRanks.has(candidate.priorityRank))
      return false;
    memberIds.add(candidate.memberId);
    priorityRanks.add(candidate.priorityRank);
  }
  return true;
}

function isStrictPriorityOrder(candidates: readonly SpecialtyPolicyCandidate[]): boolean {
  return candidates.every(
    (candidate, index) =>
      index === 0 ||
      candidate.priorityRank > (candidates[index - 1]?.priorityRank ?? Number.POSITIVE_INFINITY),
  );
}

function sameCandidate(
  left: SpecialtyCandidateSnapshot,
  right: SpecialtyCandidateSnapshot,
): boolean {
  return (
    left.memberId === right.memberId &&
    left.priorityRank === right.priorityRank &&
    sameEligibility(left.generalEligibility, right.generalEligibility) &&
    sameEligibility(left.specialtyEligibility, right.specialtyEligibility)
  );
}

function sameEligibility(left: SpecialtyEligibility, right: SpecialtyEligibility): boolean {
  if (left.status !== right.status) return false;
  if (left.status === 'eligible' || right.status === 'eligible') return true;
  return (
    left.reasonCodes.length === right.reasonCodes.length &&
    left.reasonCodes.every((reason, index) => reason === right.reasonCodes[index])
  );
}

function isAdjudicationPhase(value: unknown): value is SpecialtyAdjudicationPhase {
  return (
    value === 'resolving_higher_priority_candidates' ||
    value === 'awaiting_original_bidder' ||
    value === 'awaiting_resume'
  );
}

function isSeatResolution(value: unknown): value is SpecialtySeatResolution {
  if (!isRecord(value)) return false;
  if (value.kind === 'awarded') {
    return (
      isMemberId(value.awardedToMemberId) &&
      isOpaqueId(value.awardReference) &&
      (value.awardedBy === 'higher_priority_candidate' || value.awardedBy === 'original_bidder')
    );
  }
  return (
    value.kind === 'released' &&
    isMemberId(value.releasedByMemberId) &&
    isReleaseReason(value.reason)
  );
}

function isReleaseReason(value: unknown): value is SpecialtyReleaseReason {
  return (
    value === 'declined' ||
    value === 'unreachable' ||
    value === 'withdrawn' ||
    value === 'ineligible_on_recheck'
  );
}

function isUniqueOpaqueIdArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isOpaqueId(item)) &&
    new Set(value).size === value.length
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256
  );
}

function isMemberId(value: unknown): value is number {
  return isPositiveInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function rejectionMessage(code: SpecialtyAdjudicationRejectCode): string {
  const messages: Record<SpecialtyAdjudicationRejectCode, string> = {
    INVALID_STATE: 'Persisted specialty adjudication state is invalid.',
    INVALID_COMMAND: 'Specialty adjudication command is invalid.',
    STALE_REVISION: 'Specialty adjudication command revision is stale.',
    DUPLICATE_COMMAND: 'Specialty adjudication command was already accepted.',
    DUPLICATE_REQUEST: 'Specialty request was already evaluated.',
    ADJUDICATION_ALREADY_ACTIVE: 'Another specialty adjudication is already active.',
    INVALID_REQUEST: 'Specialty request is invalid.',
    INVALID_POLICY: 'Specialty policy is invalid.',
    UNRESOLVED_OFFICIAL_POLICY: 'Specialty decline or recall policy is unresolved.',
    AMBIGUOUS_SPECIALTY_PRIORITY: 'Specialty priority has an unresolved tie.',
    ORIGINAL_CANDIDATE_MISSING: 'Normal bidder is missing from the specialty policy.',
    ORIGINAL_GENERAL_INELIGIBLE: 'Normal bidder is not generally eligible for this position.',
    ORIGINAL_SPECIALTY_INELIGIBLE: 'Normal bidder is not specialty eligible for this position.',
    NO_ACTIVE_ADJUDICATION: 'No active specialty adjudication exists.',
    REQUEST_ID_MISMATCH: 'Command does not match the active specialty request.',
    OUT_OF_ORDER_CANDIDATE: 'Candidate is not next in approved specialty priority order.',
    CANDIDATE_ALREADY_RESOLVED: 'Candidate was already resolved.',
    CANDIDATES_ALREADY_RESOLVED: 'Higher-priority candidate resolution is already complete.',
    ORIGINAL_RESOLUTION_NOT_READY: 'Original bidder cannot be resolved at this stage.',
    ADJUDICATION_NOT_RESOLVED: 'Specialty adjudication is not yet ready to resume.',
    ALREADY_RESUMED: 'The original normal turn was already resumed.',
    INVALID_OUTCOME: 'Specialty candidate outcome is invalid.',
  };
  return messages[code];
}
