/**
 * Pure, source-safe post-Bid policy decisions. Persistence and rendering are
 * deliberately outside this module: callers must retain the immutable annual
 * session snapshot and must never turn a TeleStaff observation into a rewrite
 * of the approved result.
 */

export type LeadTimeMode = 'HARD_MINIMUM' | 'TARGET' | 'WARNING_ONLY';

export interface FutureRosterObservation {
  readonly memberId: number;
  readonly shift: string | null;
  readonly station: string | null;
  readonly unit: string | null;
  readonly position: string | null;
  readonly aDay: string | null;
  /** Provenance from the fresh staffing observation; never inferred. */
  readonly mappingStatus?: 'MAPPED' | 'UNMAPPED_POSITION' | 'DUPLICATE_OR_AMBIGUOUS_MAPPING';
  /** False only when the observation cannot be linked to a canonical member. */
  readonly knownMember?: boolean;
}

/** Immutable Post-Bid roster record, persisted at finalization review. */
export interface TransitionRosterEntry extends FutureRosterObservation {
  readonly employeeId: string;
  readonly memberName: string;
  readonly rank: string | null;
  readonly specialty: string | null;
  readonly priorAssignmentPositionId: string | null;
  readonly currentShift: string | null;
  readonly currentStation: string | null;
  readonly currentUnit: string | null;
  readonly currentPosition: string | null;
  readonly currentADay: string | null;
  readonly positionId: string;
  readonly annualSessionId: string;
  readonly annualBidYear: number;
  readonly ruleBookVersion: string;
}

export function evaluateFinalization(input: {
  annualCompletionAtMs: number | null;
  expectedPositionIds: readonly string[];
  awards: readonly { memberId: number; positionId: string }[];
  unresolvedMemberIds: readonly number[];
  topologyReference: string | null;
  ruleBookVersion: string | null;
}): { ok: true } | { ok: false; blockingCodes: string[] } {
  const blocking = new Set<string>();
  if (input.annualCompletionAtMs === null || input.annualCompletionAtMs <= 0)
    blocking.add('ANNUAL_COMPLETION_MISSING');
  if (input.topologyReference === null || input.topologyReference.trim() === '')
    blocking.add('FROZEN_TOPOLOGY_REFERENCE_MISSING');
  if (input.ruleBookVersion === null || input.ruleBookVersion.trim() === '')
    blocking.add('RULEBOOK_VERSION_MISSING');
  if (input.unresolvedMemberIds.length > 0) blocking.add('UNRESOLVED_MEMBERS_BLOCK_FINALIZATION');
  const positions = new Set<string>();
  const members = new Set<number>();
  for (const award of input.awards) {
    if (positions.has(award.positionId)) blocking.add('DUPLICATE_POSITION_FILL');
    if (members.has(award.memberId)) blocking.add('DUPLICATE_MEMBER_AWARD');
    positions.add(award.positionId);
    members.add(award.memberId);
  }
  if (
    input.expectedPositionIds.length === 0 ||
    input.expectedPositionIds.some((positionId) => !positions.has(positionId))
  )
    blocking.add('REQUIRED_ANNUAL_AWARD_MISSING');
  return blocking.size === 0 ? { ok: true } : { ok: false, blockingCodes: [...blocking].sort() };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
}

export function evaluateLeadTime(input: {
  completionOn: string;
  effectiveOn: string;
  policy: { mode: LeadTimeMode; days: number } | null;
}):
  | { ok: true; warning?: 'EFFECTIVE_DATE_TARGET_NOT_MET' | 'EFFECTIVE_DATE_WARNING' }
  | {
      ok: false;
      code:
        | 'TRANSITION_POLICY_MISSING'
        | 'INVALID_EFFECTIVE_DATE'
        | 'EFFECTIVE_DATE_HARD_MINIMUM_NOT_MET';
    } {
  if (input.policy === null) return { ok: false, code: 'TRANSITION_POLICY_MISSING' };
  if (
    !isCalendarDate(input.completionOn) ||
    !isCalendarDate(input.effectiveOn) ||
    !Number.isInteger(input.policy.days) ||
    input.policy.days < 0 ||
    input.effectiveOn < input.completionOn
  )
    return { ok: false, code: 'INVALID_EFFECTIVE_DATE' };
  if (daysBetween(input.completionOn, input.effectiveOn) >= input.policy.days) return { ok: true };
  if (input.policy.mode === 'HARD_MINIMUM')
    return { ok: false, code: 'EFFECTIVE_DATE_HARD_MINIMUM_NOT_MET' };
  return {
    ok: true,
    warning:
      input.policy.mode === 'TARGET' ? 'EFFECTIVE_DATE_TARGET_NOT_MET' : 'EFFECTIVE_DATE_WARNING',
  };
}

export type ReconciliationClassification =
  | 'EXACT_MATCH'
  | 'MISSING_EXPECTED_CHANGE'
  | 'UNEXPECTED_ASSIGNMENT'
  | 'SHIFT_MISMATCH'
  | 'STATION_MISMATCH'
  | 'UNIT_MISMATCH'
  | 'POSITION_MISMATCH'
  | 'A_DAY_MISMATCH'
  | 'UNKNOWN_MEMBER'
  | 'UNMAPPED_POSITION'
  | 'DUPLICATE_OR_AMBIGUOUS_MAPPING'
  | 'EXTRA_UNEXPECTED_CHANGE';

export function reconcileFutureRoster(
  expected: readonly FutureRosterObservation[],
  observed: readonly FutureRosterObservation[],
): Array<{ memberId: number; classification: ReconciliationClassification }> {
  const expectedByMember = new Map<number, FutureRosterObservation>();
  const observedByMember = new Map<number, FutureRosterObservation>();
  const duplicateMembers = new Set<number>();
  for (const row of expected) {
    if (expectedByMember.has(row.memberId)) duplicateMembers.add(row.memberId);
    expectedByMember.set(row.memberId, row);
  }
  for (const row of observed) {
    if (observedByMember.has(row.memberId)) duplicateMembers.add(row.memberId);
    observedByMember.set(row.memberId, row);
  }
  const results: Array<{ memberId: number; classification: ReconciliationClassification }> = [];
  for (const memberId of [
    ...new Set([...expectedByMember.keys(), ...observedByMember.keys()]),
  ].sort((a, b) => a - b)) {
    if (duplicateMembers.has(memberId)) {
      results.push({ memberId, classification: 'DUPLICATE_OR_AMBIGUOUS_MAPPING' });
      continue;
    }
    const wanted = expectedByMember.get(memberId);
    const seen = observedByMember.get(memberId);
    if (wanted === undefined) {
      results.push({
        memberId,
        classification: seen?.knownMember === false ? 'UNKNOWN_MEMBER' : 'EXTRA_UNEXPECTED_CHANGE',
      });
      continue;
    }
    if (seen === undefined) {
      results.push({ memberId, classification: 'MISSING_EXPECTED_CHANGE' });
      continue;
    }
    if (seen.knownMember === false) {
      results.push({ memberId, classification: 'UNKNOWN_MEMBER' });
      continue;
    }
    if (seen.mappingStatus === 'UNMAPPED_POSITION') {
      results.push({ memberId, classification: 'UNMAPPED_POSITION' });
      continue;
    }
    if (seen.mappingStatus === 'DUPLICATE_OR_AMBIGUOUS_MAPPING') {
      results.push({ memberId, classification: 'DUPLICATE_OR_AMBIGUOUS_MAPPING' });
      continue;
    }
    const field = (
      [
        ['shift', 'SHIFT_MISMATCH'],
        ['station', 'STATION_MISMATCH'],
        ['unit', 'UNIT_MISMATCH'],
        ['position', 'POSITION_MISMATCH'],
        ['aDay', 'A_DAY_MISMATCH'],
      ] as const
    ).find(([key]) => wanted[key] !== seen[key]);
    results.push({ memberId, classification: field?.[1] ?? 'EXACT_MATCH' });
  }
  return results;
}
