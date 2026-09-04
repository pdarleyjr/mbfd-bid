/**
 * Pure, fail-closed planning for year-round personnel changes.
 *
 * This deliberately has no D1 dependency. The route loads canonical member,
 * staffing-position, and assignment rows, then uses this module to validate
 * the requested transition before preparing its one D1 batch. The immutable
 * personnel_lifecycle_events ledger is evidence for the mutation; it is not a
 * replacement person or assignment model.
 */

export const PERSONNEL_LIFECYCLE_KINDS = [
  'NEW_HIRE',
  'REACTIVATION',
  'PROMOTION',
  'DEMOTION',
  'TRANSFER',
  'ADMIN_REASSIGNMENT',
  'RETIREMENT',
  'SEPARATION',
  'VACATE',
  'POSITION_CREATE',
  'POSITION_RETIRE',
  'CORRECTION',
] as const;

export type PersonnelLifecycleKind = (typeof PERSONNEL_LIFECYCLE_KINDS)[number];

export const EMPLOYMENT_STATUSES = [
  'unknown',
  'active',
  'inactive',
  'retired',
  'separated',
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const MEMBER_RANKS = ['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] as const;
export type MemberRank = (typeof MEMBER_RANKS)[number];
export type PersonnelClassification = MemberRank | 'CIVILIAN';

export type AssignmentStatus = 'planned' | 'active' | 'superseded' | 'cancelled' | 'ended';
export type AssignmentOriginType =
  | 'TELESTAFF_IMPORT'
  | 'BID_AWARD'
  | 'MID_CYCLE_VACANCY'
  | 'ADMIN_TRANSFER'
  | 'PROMOTION'
  | 'CORRECTION';

export interface PersonnelMemberState {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: PersonnelClassification;
  employmentStatus: EmploymentStatus;
  employmentStatusEffectiveOn: string | null;
  separationType: string | null;
}

export interface PersonnelAssignmentState {
  id: string;
  memberId: number;
  staffingPositionId: string;
  status: AssignmentStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * The minimum immutable ledger material needed to reconstruct a member at an
 * effective date.  It intentionally omits names and employee identifiers:
 * callers retain those from the canonical member row while this evidence
 * supplies only mutable personnel state.
 */
export interface PersonnelLifecycleProjectionEvent {
  id: string;
  kind: PersonnelLifecycleKind;
  effectiveOn: string;
  employmentStatusAfter: EmploymentStatus | null;
  rankAfter: MemberRank | null;
  separationType: string | null;
  beforeState: string | Record<string, unknown>;
  createdAt: number;
}

export interface PersonnelLifecycleInput {
  kind: PersonnelLifecycleKind;
  effectiveOn: string;
  reason: string;
  actorSubject: string;
  idempotencyKey: string;
  member: PersonnelMemberState;
  activeAssignments: readonly PersonnelAssignmentState[];
  /** The target slot for a transfer/promotion/reassignment or a vacancy action. */
  staffingPositionId?: string;
  /** Required for a rank-changing action and new hire. */
  rankAfter?: MemberRank;
  /** Required by retirement/separation; a correction may also explicitly set it. */
  separationType?: string;
  /** Only accepted for an explicit CORRECTION. */
  employmentStatusAfter?: EmploymentStatus;
  /** An immutable correction can point to the event it corrects; it never updates it. */
  supersedesEventId?: string;
  /** Route-generated immutable ledger ID used as member_assignments.origin_ref. */
  eventId?: string;
  /** Injected UTC date keeps future-dated behavior deterministic in tests. */
  nowOn: string;
}

export interface LifecycleMemberProjection {
  employmentStatus?: EmploymentStatus;
  employmentStatusEffectiveOn?: string;
  separationType?: string | null;
  rank?: PersonnelClassification;
  promotedAt?: string;
}

export interface AssignmentClosure {
  id: string;
  /**
   * Future changes retain the source row's non-cancelled status until their
   * effective boundary. Its range closes now; read models select by range.
   */
  status: AssignmentStatus;
  effectiveTo: string;
}

export interface AssignmentCreation {
  id: string | null;
  memberId: number;
  staffingPositionId: string;
  originType: AssignmentOriginType;
  originRef: string;
  status: 'planned' | 'active';
  effectiveFrom: string;
}

export interface LifecycleEventDraft {
  kind: PersonnelLifecycleKind;
  effectiveOn: string;
  employmentStatusBefore: EmploymentStatus;
  employmentStatusAfter: EmploymentStatus;
  rankBefore: MemberRank | null;
  rankAfter: MemberRank | null;
  separationType: string | null;
  reason: string;
  origin: 'ADMIN';
  actorSubject: string;
  idempotencyKey: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  supersedesEventId: string | null;
}

export interface PersonnelLifecyclePlan {
  ok: true;
  memberProjection: LifecycleMemberProjection | null;
  assignmentClosures: AssignmentClosure[];
  assignmentCreation: AssignmentCreation | null;
  event: LifecycleEventDraft;
}

export interface PersonnelLifecyclePlanFailure {
  ok: false;
  error:
    | 'invalid_kind'
    | 'invalid_effective_on'
    | 'invalid_now_on'
    | 'invalid_reason'
    | 'invalid_actor_subject'
    | 'invalid_idempotency_key'
    | 'member_employment_status_unknown'
    | 'member_not_active'
    | 'member_already_active'
    | 'rank_after_required'
    | 'rank_change_required'
    | 'invalid_promotion_rank'
    | 'invalid_demotion_rank'
    | 'separation_type_required'
    | 'staffing_position_required'
    | 'staffing_position_not_assigned_to_member'
    | 'assignment_transition_precedes_active_assignment'
    | 'multiple_active_assignments'
    | 'invalid_correction';
}

export type PersonnelLifecyclePlanResult = PersonnelLifecyclePlan | PersonnelLifecyclePlanFailure;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const rankOrder = new Map<MemberRank, number>(MEMBER_RANKS.map((rank, index) => [rank, index]));

function calendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isIsoCalendarDate(value: string): boolean {
  return calendarDate(value);
}

function isEmploymentStatus(value: unknown): value is EmploymentStatus {
  return typeof value === 'string' && (EMPLOYMENT_STATUSES as readonly string[]).includes(value);
}

function isMemberRank(value: unknown): value is MemberRank {
  return typeof value === 'string' && (MEMBER_RANKS as readonly string[]).includes(value);
}

function parseStateRecord(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isStatusChanging(kind: PersonnelLifecycleKind): boolean {
  return ['NEW_HIRE', 'REACTIVATION', 'RETIREMENT', 'SEPARATION', 'CORRECTION'].includes(kind);
}

/**
 * Projects member rank and employment state as of an effective date without
 * trusting the mutable current member projection.  This is essential for
 * future-dated retirement/reactivation sequences: the last committed member
 * row represents today, while the immutable ledger represents the requested
 * date.  When the requested date precedes the first event, that event's
 * recorded before-state restores the prior projection instead of leaking a
 * later current state backward in time.
 */
export function derivePersonnelMemberAsOf(
  member: PersonnelMemberState,
  events: readonly PersonnelLifecycleProjectionEvent[],
  asOf: string,
): PersonnelMemberState {
  const ordered = [...events]
    .filter((event) => calendarDate(event.effectiveOn))
    .sort(
      (left, right) =>
        left.effectiveOn.localeCompare(right.effectiveOn) ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );
  const firstEvent = ordered[0];
  const firstBefore = firstEvent === undefined ? {} : parseStateRecord(firstEvent.beforeState);
  const projected: PersonnelMemberState = {
    ...member,
    rank: isMemberRank(firstBefore.rank) ? firstBefore.rank : member.rank,
    employmentStatus: isEmploymentStatus(firstBefore.employmentStatus)
      ? firstBefore.employmentStatus
      : member.employmentStatus,
    employmentStatusEffectiveOn:
      typeof firstBefore.employmentStatusEffectiveOn === 'string' &&
      isIsoCalendarDate(firstBefore.employmentStatusEffectiveOn)
        ? firstBefore.employmentStatusEffectiveOn
        : member.employmentStatusEffectiveOn,
    separationType:
      firstBefore.separationType === null || typeof firstBefore.separationType === 'string'
        ? firstBefore.separationType
        : member.separationType,
  };

  for (const event of ordered) {
    if (event.effectiveOn > asOf) break;
    if (event.rankAfter !== null) projected.rank = event.rankAfter;
    if (event.employmentStatusAfter !== null)
      projected.employmentStatus = event.employmentStatusAfter;
    if (isStatusChanging(event.kind)) {
      projected.employmentStatusEffectiveOn = event.effectiveOn;
      projected.separationType = event.separationType;
    }
  }
  return projected;
}

export function isPersonnelLifecycleKind(value: string): value is PersonnelLifecycleKind {
  return (PERSONNEL_LIFECYCLE_KINDS as readonly string[]).includes(value);
}

function priorCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function assignmentOriginFor(kind: PersonnelLifecycleKind): AssignmentOriginType {
  if (kind === 'PROMOTION') return 'PROMOTION';
  if (kind === 'CORRECTION') return 'CORRECTION';
  return 'ADMIN_TRANSFER';
}

function requiresActiveMember(kind: PersonnelLifecycleKind): boolean {
  return [
    'PROMOTION',
    'DEMOTION',
    'TRANSFER',
    'ADMIN_REASSIGNMENT',
    'RETIREMENT',
    'SEPARATION',
    'VACATE',
  ].includes(kind);
}

function requiresRankAfter(kind: PersonnelLifecycleKind): boolean {
  return ['NEW_HIRE', 'PROMOTION', 'DEMOTION'].includes(kind);
}

function findsAssignmentsInEffect(
  assignments: readonly PersonnelAssignmentState[],
  effectiveOn: string,
): PersonnelAssignmentState[] {
  return assignments.filter(
    (assignment) =>
      assignment.status !== 'cancelled' &&
      assignment.effectiveFrom <= effectiveOn &&
      (assignment.effectiveTo === null || assignment.effectiveTo >= effectiveOn),
  );
}

function failure(error: PersonnelLifecyclePlanFailure['error']): PersonnelLifecyclePlanFailure {
  return { ok: false, error };
}

function employmentStatusAfter(input: PersonnelLifecycleInput): EmploymentStatus {
  switch (input.kind) {
    case 'NEW_HIRE':
    case 'REACTIVATION':
      return 'active';
    case 'RETIREMENT':
      return 'retired';
    case 'SEPARATION':
      return 'separated';
    case 'CORRECTION':
      return input.employmentStatusAfter ?? input.member.employmentStatus;
    default:
      return input.member.employmentStatus;
  }
}

function rankAfter(input: PersonnelLifecycleInput): PersonnelClassification {
  return input.rankAfter ?? input.member.rank;
}

function shouldCreateAssignment(input: PersonnelLifecycleInput): boolean {
  return (
    input.staffingPositionId !== undefined &&
    !['VACATE', 'RETIREMENT', 'SEPARATION', 'POSITION_CREATE', 'POSITION_RETIRE'].includes(
      input.kind,
    )
  );
}

/**
 * Produce a fully validated, side-effect-free mutation plan. The caller must
 * still ensure the target staffing slot is authorized and unoccupied before
 * committing the resulting D1 batch.
 */
export function planPersonnelLifecycleChange(
  input: PersonnelLifecycleInput,
): PersonnelLifecyclePlanResult {
  if (!isPersonnelLifecycleKind(input.kind)) return failure('invalid_kind');
  if (!calendarDate(input.effectiveOn)) return failure('invalid_effective_on');
  if (!calendarDate(input.nowOn)) return failure('invalid_now_on');

  const reason = input.reason.trim();
  if (reason.length < 4 || reason.length > 500) return failure('invalid_reason');
  if (input.actorSubject.trim().length === 0 || input.actorSubject.length > 256) {
    return failure('invalid_actor_subject');
  }
  if (
    input.idempotencyKey.trim().length === 0 ||
    input.idempotencyKey !== input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 256
  ) {
    return failure('invalid_idempotency_key');
  }

  if (
    requiresRankAfter(input.kind) &&
    input.rankAfter === undefined &&
    input.member.rank !== 'CIVILIAN'
  ) {
    return failure('rank_after_required');
  }
  if (
    (input.kind === 'RETIREMENT' || input.kind === 'SEPARATION') &&
    !input.separationType?.trim()
  ) {
    return failure('separation_type_required');
  }
  if (input.kind === 'VACATE' && input.staffingPositionId === undefined) {
    return failure('staffing_position_required');
  }
  if (
    input.kind === 'CORRECTION' &&
    input.rankAfter === undefined &&
    input.employmentStatusAfter === undefined
  ) {
    return failure('invalid_correction');
  }

  if (input.kind === 'REACTIVATION' && input.member.employmentStatus === 'active') {
    return failure('member_already_active');
  }
  if (requiresActiveMember(input.kind)) {
    if (input.member.employmentStatus === 'unknown')
      return failure('member_employment_status_unknown');
    if (input.member.employmentStatus !== 'active') return failure('member_not_active');
  }

  const nextRank = rankAfter(input);
  if ((input.kind === 'PROMOTION' || input.kind === 'DEMOTION') && nextRank === input.member.rank) {
    return failure('rank_change_required');
  }
  if (
    input.kind === 'PROMOTION' &&
    (!isMemberRank(nextRank) ||
      !isMemberRank(input.member.rank) ||
      (rankOrder.get(nextRank) ?? -1) <=
        (rankOrder.get(input.member.rank) ?? Number.MAX_SAFE_INTEGER))
  ) {
    return failure('invalid_promotion_rank');
  }
  if (
    input.kind === 'DEMOTION' &&
    (!isMemberRank(nextRank) ||
      !isMemberRank(input.member.rank) ||
      (rankOrder.get(nextRank) ?? Number.MAX_SAFE_INTEGER) >=
        (rankOrder.get(input.member.rank) ?? -1))
  ) {
    return failure('invalid_demotion_rank');
  }

  const inEffect = findsAssignmentsInEffect(input.activeAssignments, input.effectiveOn);
  if (inEffect.length > 1) return failure('multiple_active_assignments');
  if (input.kind === 'VACATE') {
    const matching = inEffect.find(
      (assignment) => assignment.staffingPositionId === input.staffingPositionId,
    );
    if (matching === undefined) return failure('staffing_position_not_assigned_to_member');
  }
  if (inEffect.some((assignment) => assignment.effectiveFrom >= input.effectiveOn)) {
    return failure('assignment_transition_precedes_active_assignment');
  }

  const assignmentClosures = inEffect
    .filter(
      (assignment) =>
        input.kind !== 'VACATE' || assignment.staffingPositionId === input.staffingPositionId,
    )
    .map((assignment) => ({
      id: assignment.id,
      status: input.effectiveOn > input.nowOn ? assignment.status : ('ended' as const),
      effectiveTo: priorCalendarDate(input.effectiveOn),
    }));

  const targetSlot = input.staffingPositionId?.trim();
  const assignmentCreation =
    shouldCreateAssignment(input) && targetSlot !== undefined && targetSlot.length > 0
      ? {
          id: null,
          memberId: input.member.id,
          staffingPositionId: targetSlot,
          originType: assignmentOriginFor(input.kind),
          originRef: input.eventId ?? `personnel:${input.idempotencyKey}`,
          status: (input.effectiveOn > input.nowOn ? 'planned' : 'active') as 'planned' | 'active',
          effectiveFrom: input.effectiveOn,
        }
      : null;

  const nextEmploymentStatus = employmentStatusAfter(input);
  const nextSeparationType =
    nextEmploymentStatus === 'retired' || nextEmploymentStatus === 'separated'
      ? (input.separationType?.trim() ?? null)
      : null;

  let memberProjection: LifecycleMemberProjection | null = null;
  if (input.effectiveOn <= input.nowOn) {
    const projection: LifecycleMemberProjection = {};
    if (isStatusChanging(input.kind)) {
      projection.employmentStatus = nextEmploymentStatus;
      projection.employmentStatusEffectiveOn = input.effectiveOn;
      projection.separationType = nextSeparationType;
      // Keep the current projection explicit even when a retirement or
      // separation preserves the member's last held rank.
      projection.rank = nextRank;
    }
    if (
      input.kind === 'NEW_HIRE' ||
      input.kind === 'PROMOTION' ||
      input.kind === 'DEMOTION' ||
      input.kind === 'CORRECTION'
    ) {
      projection.rank = nextRank;
    }
    if (input.kind === 'PROMOTION') projection.promotedAt = input.effectiveOn;
    memberProjection = Object.keys(projection).length > 0 ? projection : null;
  }

  const priorAssignment = inEffect[0] ?? null;
  const beforeState: Record<string, unknown> = {
    memberId: input.member.id,
    employmentStatus: input.member.employmentStatus,
    employmentStatusEffectiveOn: input.member.employmentStatusEffectiveOn,
    separationType: input.member.separationType,
    rank: input.member.rank === 'CIVILIAN' ? null : input.member.rank,
    ...(input.member.rank === 'CIVILIAN' ? { personnelClassification: 'CIVILIAN' } : {}),
    assignment:
      priorAssignment === null
        ? null
        : {
            id: priorAssignment.id,
            staffingPositionId: priorAssignment.staffingPositionId,
            effectiveFrom: priorAssignment.effectiveFrom,
            effectiveTo: priorAssignment.effectiveTo,
            status: priorAssignment.status,
          },
  };
  const afterState: Record<string, unknown> = {
    memberId: input.member.id,
    employmentStatus: nextEmploymentStatus,
    separationType: nextSeparationType,
    rank: nextRank === 'CIVILIAN' ? null : nextRank,
    ...(nextRank === 'CIVILIAN' ? { personnelClassification: 'CIVILIAN' } : {}),
    staffingPositionId: assignmentCreation?.staffingPositionId ?? input.staffingPositionId ?? null,
    assignment:
      assignmentCreation === null
        ? null
        : {
            staffingPositionId: assignmentCreation.staffingPositionId,
            effectiveFrom: assignmentCreation.effectiveFrom,
            status: assignmentCreation.status,
          },
  };

  return {
    ok: true,
    memberProjection,
    assignmentClosures,
    assignmentCreation,
    event: {
      kind: input.kind,
      effectiveOn: input.effectiveOn,
      employmentStatusBefore: input.member.employmentStatus,
      employmentStatusAfter: nextEmploymentStatus,
      rankBefore: isMemberRank(input.member.rank) ? input.member.rank : null,
      rankAfter: isMemberRank(nextRank) ? nextRank : null,
      separationType: nextSeparationType,
      reason,
      origin: 'ADMIN',
      actorSubject: input.actorSubject.trim(),
      idempotencyKey: input.idempotencyKey,
      beforeState,
      afterState,
      supersedesEventId: input.supersedesEventId?.trim() || null,
    },
  };
}
