/**
 * Pure, fail-closed planning for the effective-dated transition from a
 * completed Bid into future staffing assignments. This module has no D1 or
 * clock dependency: the caller supplies a frozen session snapshot and the
 * canonical effective-dated rows it intends to write in one transaction.
 */

export const BID_ASSIGNMENT_STATUSES = [
  'planned',
  'active',
  'superseded',
  'cancelled',
  'ended',
] as const;

export type BidAssignmentStatus = (typeof BID_ASSIGNMENT_STATUSES)[number];

export interface CompletedBidSessionState {
  id: string;
  phase: string;
  isMock: boolean;
  awardsFrozen: boolean;
}

export interface FrozenCompletedBidAward {
  id: string;
  bidSessionId: string;
  positionId: string;
  memberId: number;
  ordinal: number;
  status: string;
}

export interface BidAwardPositionBinding {
  positionId: string;
  staffingPositionId: string;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  targetStatus: 'active' | 'retired' | 'unknown';
}

export interface EffectiveBidAssignment {
  id: string;
  memberId: number;
  staffingPositionId: string;
  status: BidAssignmentStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface BidAwardTransitionInput {
  session: CompletedBidSessionState;
  /** The full frozen opportunity set; every position must have one award. */
  expectedPositionIds: readonly string[];
  awards: readonly FrozenCompletedBidAward[];
  bindings: readonly BidAwardPositionBinding[];
  assignments: readonly EffectiveBidAssignment[];
  /** Current roster view date. The transition date must be strictly later. */
  asOfDate: string;
  /** Requested future staffing-effective date. */
  effectiveOn: string;
}

export interface BidAwardAssignmentClosure {
  id: string;
  memberId: number;
  staffingPositionId: string;
  /** Future closures retain status until their effective range ends. */
  status: 'active';
  effectiveTo: string;
}

export interface PlannedBidAwardAssignment {
  id: null;
  awardId: string;
  bidSessionId: string;
  memberId: number;
  positionId: string;
  staffingPositionId: string;
  originType: 'BID_AWARD';
  originRef: string;
  status: 'planned';
  effectiveFrom: string;
  effectiveTo: null;
}

export interface CurrentToNewAssignmentRow {
  ordinal: number;
  awardId: string;
  memberId: number;
  positionId: string;
  currentAssignment: {
    id: string;
    staffingPositionId: string;
    status: 'active';
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  newAssignment: {
    staffingPositionId: string;
    effectiveFrom: string;
    originRef: string;
    status: 'planned';
  };
}

export interface BidAwardTransitionPlan {
  ok: true;
  bidSessionId: string;
  asOfDate: string;
  effectiveOn: string;
  assignmentClosures: readonly BidAwardAssignmentClosure[];
  plannedAssignments: readonly PlannedBidAwardAssignment[];
  currentToNew: readonly CurrentToNewAssignmentRow[];
}

export interface BidAwardTransitionFailure {
  ok: false;
  error:
    | 'invalid_session'
    | 'mock_session_not_transitionable'
    | 'session_not_complete'
    | 'frozen_awards_required'
    | 'invalid_as_of_date'
    | 'invalid_effective_on'
    | 'effective_on_must_be_future'
    | 'invalid_expected_position'
    | 'duplicate_expected_position'
    | 'invalid_frozen_award'
    | 'award_session_mismatch'
    | 'duplicate_award_id'
    | 'duplicate_award_position'
    | 'duplicate_award_member'
    | 'duplicate_award_ordinal'
    | 'incomplete_frozen_awards'
    | 'invalid_position_binding'
    | 'missing_position_binding'
    | 'ambiguous_position_binding'
    | 'position_binding_not_approved'
    | 'invalid_target_position'
    | 'duplicate_award_target'
    | 'invalid_assignment'
    | 'member_assignment_temporal_overlap'
    | 'position_assignment_temporal_overlap'
    | 'target_occupied_at_effective_on'
    | 'member_assignment_conflict_at_effective_on'
    | 'planned_member_assignment_overlap'
    | 'planned_target_assignment_overlap';
}

export type BidAwardTransitionResult = BidAwardTransitionPlan | BidAwardTransitionFailure;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATE = '9999-12-31';

/**
 * Returns a deterministic, future-only plan. The caller must re-read the
 * supplied canonical rows and apply the plan atomically; this function never
 * authorizes a mock, fills a vacancy by inference, or mutates source input.
 */
export function planBidAwardTransition(input: BidAwardTransitionInput): BidAwardTransitionResult {
  const sessionFailure = validateSession(input.session);
  if (sessionFailure !== null) return failure(sessionFailure);
  if (!isIsoCalendarDate(input.asOfDate)) return failure('invalid_as_of_date');
  if (!isIsoCalendarDate(input.effectiveOn)) return failure('invalid_effective_on');
  if (input.effectiveOn <= input.asOfDate) return failure('effective_on_must_be_future');

  const expectedFailure = validateExpectedPositions(input.expectedPositionIds);
  if (expectedFailure !== null) return failure(expectedFailure);
  const awards = validateAndSortAwards(input);
  if (!awards.ok) return awards;

  const bindings = resolveBindings(awards.awards, input.bindings);
  if (!bindings.ok) return bindings;

  const assignmentsFailure = validateAssignments(input.assignments);
  if (assignmentsFailure !== null) return failure(assignmentsFailure);

  for (const binding of bindings.bindings) {
    if (
      input.assignments.some((assignment) =>
        occupiesAt(assignment, input.effectiveOn, binding.staffingPositionId),
      )
    ) {
      return failure('target_occupied_at_effective_on');
    }
  }

  const priorDate = priorCalendarDate(input.effectiveOn);
  const closures: BidAwardAssignmentClosure[] = [];
  const currentToNew: CurrentToNewAssignmentRow[] = [];
  const plannedAssignments: PlannedBidAwardAssignment[] = [];

  for (const award of awards.awards) {
    const binding = bindings.byAwardId.get(award.id);
    if (binding === undefined) return failure('invalid_position_binding');

    const assignmentsAtEffectiveOn = input.assignments.filter((assignment) =>
      appliesAt(assignment, input.effectiveOn),
    );
    const memberAssignmentsAtEffectiveOn = assignmentsAtEffectiveOn.filter(
      (assignment) => assignment.memberId === award.memberId,
    );
    if (memberAssignmentsAtEffectiveOn.length > 1) {
      return failure('member_assignment_temporal_overlap');
    }
    const existingAtEffectiveOn = memberAssignmentsAtEffectiveOn[0] ?? null;
    if (existingAtEffectiveOn !== null) {
      if (
        existingAtEffectiveOn.status !== 'active' ||
        existingAtEffectiveOn.effectiveFrom > input.asOfDate ||
        existingAtEffectiveOn.effectiveFrom >= input.effectiveOn
      ) {
        return failure('member_assignment_conflict_at_effective_on');
      }
      closures.push({
        id: existingAtEffectiveOn.id,
        memberId: existingAtEffectiveOn.memberId,
        staffingPositionId: existingAtEffectiveOn.staffingPositionId,
        status: 'active',
        effectiveTo: priorDate,
      });
    }

    const currentAssignments = input.assignments.filter(
      (assignment) =>
        assignment.memberId === award.memberId && activeAt(assignment, input.asOfDate),
    );
    if (currentAssignments.length > 1) return failure('member_assignment_temporal_overlap');
    const current = currentAssignments[0] ?? null;
    const originRef = `bid-award:${input.session.id}:${award.id}`;
    const planned: PlannedBidAwardAssignment = {
      id: null,
      awardId: award.id,
      bidSessionId: input.session.id,
      memberId: award.memberId,
      positionId: award.positionId,
      staffingPositionId: binding.staffingPositionId,
      originType: 'BID_AWARD',
      originRef,
      status: 'planned',
      effectiveFrom: input.effectiveOn,
      effectiveTo: null,
    };
    plannedAssignments.push(planned);
    currentToNew.push({
      ordinal: award.ordinal,
      awardId: award.id,
      memberId: award.memberId,
      positionId: award.positionId,
      currentAssignment:
        current === null
          ? null
          : {
              id: current.id,
              staffingPositionId: current.staffingPositionId,
              status: 'active',
              effectiveFrom: current.effectiveFrom,
              effectiveTo: current.effectiveTo,
            },
      newAssignment: {
        staffingPositionId: planned.staffingPositionId,
        effectiveFrom: planned.effectiveFrom,
        originRef: planned.originRef,
        status: 'planned',
      },
    });
  }

  const closureById = new Map(closures.map((closure) => [closure.id, closure]));
  for (const planned of plannedAssignments) {
    for (const assignment of input.assignments) {
      const adjusted = closureById.get(assignment.id);
      const effectiveTo = adjusted?.effectiveTo ?? assignment.effectiveTo;
      if (
        !hasEffectiveRange(assignment) ||
        !rangesOverlap(
          planned.effectiveFrom,
          planned.effectiveTo,
          assignment.effectiveFrom,
          effectiveTo,
        )
      ) {
        continue;
      }
      if (assignment.memberId === planned.memberId)
        return failure('planned_member_assignment_overlap');
      if (assignment.staffingPositionId === planned.staffingPositionId) {
        return failure('planned_target_assignment_overlap');
      }
    }
  }

  return {
    ok: true,
    bidSessionId: input.session.id,
    asOfDate: input.asOfDate,
    effectiveOn: input.effectiveOn,
    assignmentClosures: [...closures].sort(compareClosure),
    plannedAssignments: [...plannedAssignments].sort(comparePlanned),
    currentToNew: [...currentToNew].sort(compareCurrentToNew),
  };
}

function validateSession(
  session: CompletedBidSessionState,
): BidAwardTransitionFailure['error'] | null {
  if (
    !isOpaqueId(session.id) ||
    typeof session.phase !== 'string' ||
    typeof session.isMock !== 'boolean' ||
    typeof session.awardsFrozen !== 'boolean'
  ) {
    return 'invalid_session';
  }
  if (session.isMock) return 'mock_session_not_transitionable';
  if (session.phase !== 'complete') return 'session_not_complete';
  if (!session.awardsFrozen) return 'frozen_awards_required';
  return null;
}

function validateExpectedPositions(
  positions: readonly string[],
): BidAwardTransitionFailure['error'] | null {
  if (positions.length === 0) return 'incomplete_frozen_awards';
  const seen = new Set<string>();
  for (const positionId of positions) {
    if (!isOpaqueId(positionId)) return 'invalid_expected_position';
    if (seen.has(positionId)) return 'duplicate_expected_position';
    seen.add(positionId);
  }
  return null;
}

function validateAndSortAwards(
  input: BidAwardTransitionInput,
): { ok: true; awards: FrozenCompletedBidAward[] } | BidAwardTransitionFailure {
  if (input.awards.length === 0) return failure('incomplete_frozen_awards');
  const expectedPositions = new Set(input.expectedPositionIds);
  const awardIds = new Set<string>();
  const positionIds = new Set<string>();
  const memberIds = new Set<number>();
  const ordinals = new Set<number>();
  const awards: FrozenCompletedBidAward[] = [];
  for (const award of input.awards) {
    if (
      !isOpaqueId(award.id) ||
      !isOpaqueId(award.bidSessionId) ||
      !isOpaqueId(award.positionId) ||
      !isPositiveInteger(award.memberId) ||
      !isPositiveInteger(award.ordinal) ||
      award.status !== 'awarded'
    ) {
      return failure('invalid_frozen_award');
    }
    if (award.bidSessionId !== input.session.id) return failure('award_session_mismatch');
    if (awardIds.has(award.id)) return failure('duplicate_award_id');
    if (positionIds.has(award.positionId)) return failure('duplicate_award_position');
    if (memberIds.has(award.memberId)) return failure('duplicate_award_member');
    if (ordinals.has(award.ordinal)) return failure('duplicate_award_ordinal');
    if (!expectedPositions.has(award.positionId)) return failure('incomplete_frozen_awards');
    awardIds.add(award.id);
    positionIds.add(award.positionId);
    memberIds.add(award.memberId);
    ordinals.add(award.ordinal);
    awards.push({ ...award });
  }
  if (positionIds.size !== expectedPositions.size) return failure('incomplete_frozen_awards');
  for (const positionId of expectedPositions) {
    if (!positionIds.has(positionId)) return failure('incomplete_frozen_awards');
  }
  return { ok: true, awards: awards.sort(compareAward) };
}

function resolveBindings(
  awards: readonly FrozenCompletedBidAward[],
  bindings: readonly BidAwardPositionBinding[],
):
  | {
      ok: true;
      bindings: BidAwardPositionBinding[];
      byAwardId: ReadonlyMap<string, BidAwardPositionBinding>;
    }
  | BidAwardTransitionFailure {
  for (const binding of bindings) {
    if (
      !isOpaqueId(binding.positionId) ||
      !isOpaqueId(binding.staffingPositionId) ||
      !['approved', 'pending', 'rejected'].includes(binding.approvalStatus) ||
      !['active', 'retired', 'unknown'].includes(binding.targetStatus)
    ) {
      return failure('invalid_position_binding');
    }
  }
  const byAwardId = new Map<string, BidAwardPositionBinding>();
  const resolved: BidAwardPositionBinding[] = [];
  const targetIds = new Set<string>();
  for (const award of awards) {
    const matches = bindings.filter((binding) => binding.positionId === award.positionId);
    if (matches.length === 0) return failure('missing_position_binding');
    if (matches.length !== 1) return failure('ambiguous_position_binding');
    const binding = matches[0];
    if (binding === undefined) return failure('missing_position_binding');
    if (binding.approvalStatus !== 'approved') return failure('position_binding_not_approved');
    if (binding.targetStatus !== 'active') return failure('invalid_target_position');
    if (targetIds.has(binding.staffingPositionId)) return failure('duplicate_award_target');
    targetIds.add(binding.staffingPositionId);
    const copy = { ...binding };
    byAwardId.set(award.id, copy);
    resolved.push(copy);
  }
  return { ok: true, bindings: resolved, byAwardId };
}

function validateAssignments(
  assignments: readonly EffectiveBidAssignment[],
): BidAwardTransitionFailure['error'] | null {
  const ids = new Set<string>();
  for (const assignment of assignments) {
    if (
      !isOpaqueId(assignment.id) ||
      !isPositiveInteger(assignment.memberId) ||
      !isOpaqueId(assignment.staffingPositionId) ||
      !isAssignmentStatus(assignment.status) ||
      !isIsoCalendarDate(assignment.effectiveFrom) ||
      (assignment.effectiveTo !== null && !isIsoCalendarDate(assignment.effectiveTo)) ||
      (assignment.effectiveTo !== null && assignment.effectiveTo < assignment.effectiveFrom) ||
      ids.has(assignment.id)
    ) {
      return 'invalid_assignment';
    }
    ids.add(assignment.id);
  }
  if (hasTemporalOverlap(assignments, (assignment) => String(assignment.memberId))) {
    return 'member_assignment_temporal_overlap';
  }
  if (hasTemporalOverlap(assignments, (assignment) => assignment.staffingPositionId)) {
    return 'position_assignment_temporal_overlap';
  }
  return null;
}

function hasTemporalOverlap(
  assignments: readonly EffectiveBidAssignment[],
  key: (assignment: EffectiveBidAssignment) => string,
): boolean {
  const byKey = new Map<string, EffectiveBidAssignment[]>();
  for (const assignment of assignments) {
    if (!hasEffectiveRange(assignment)) continue;
    const group = byKey.get(key(assignment)) ?? [];
    group.push(assignment);
    byKey.set(key(assignment), group);
  }
  for (const group of byKey.values()) {
    const sorted = [...group].sort(compareAssignmentRange);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const next = sorted[index];
      if (
        previous !== undefined &&
        next !== undefined &&
        rangesOverlap(
          previous.effectiveFrom,
          previous.effectiveTo,
          next.effectiveFrom,
          next.effectiveTo,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function activeAt(assignment: EffectiveBidAssignment, date: string): boolean {
  return (
    assignment.status === 'active' &&
    withinRange(assignment.effectiveFrom, assignment.effectiveTo, date)
  );
}

function appliesAt(assignment: EffectiveBidAssignment, date: string): boolean {
  return (
    hasEffectiveRange(assignment) &&
    withinRange(assignment.effectiveFrom, assignment.effectiveTo, date)
  );
}

function occupiesAt(
  assignment: EffectiveBidAssignment,
  date: string,
  staffingPositionId: string,
): boolean {
  return assignment.staffingPositionId === staffingPositionId && appliesAt(assignment, date);
}

function hasEffectiveRange(assignment: EffectiveBidAssignment): boolean {
  return assignment.status !== 'cancelled';
}

function withinRange(effectiveFrom: string, effectiveTo: string | null, date: string): boolean {
  return effectiveFrom <= date && (effectiveTo === null || effectiveTo >= date);
}

function rangesOverlap(
  leftFrom: string,
  leftTo: string | null,
  rightFrom: string,
  rightTo: string | null,
): boolean {
  return leftFrom <= (rightTo ?? MAX_DATE) && rightFrom <= (leftTo ?? MAX_DATE);
}

function priorCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (!Number.isInteger(year) || year < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isAssignmentStatus(value: unknown): value is BidAssignmentStatus {
  return (
    typeof value === 'string' && (BID_ASSIGNMENT_STATUSES as readonly string[]).includes(value)
  );
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function compareAward(left: FrozenCompletedBidAward, right: FrozenCompletedBidAward): number {
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
}

function compareClosure(left: BidAwardAssignmentClosure, right: BidAwardAssignmentClosure): number {
  return left.memberId - right.memberId || left.id.localeCompare(right.id);
}

function comparePlanned(left: PlannedBidAwardAssignment, right: PlannedBidAwardAssignment): number {
  return left.memberId - right.memberId || left.awardId.localeCompare(right.awardId);
}

function compareCurrentToNew(
  left: CurrentToNewAssignmentRow,
  right: CurrentToNewAssignmentRow,
): number {
  return left.ordinal - right.ordinal || left.awardId.localeCompare(right.awardId);
}

function compareAssignmentRange(
  left: EffectiveBidAssignment,
  right: EffectiveBidAssignment,
): number {
  return left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id);
}

function failure(error: BidAwardTransitionFailure['error']): BidAwardTransitionFailure {
  return { ok: false, error };
}
