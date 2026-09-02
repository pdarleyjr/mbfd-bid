/**
 * Deterministic annual-Bid operations. This module deliberately has no D1,
 * Durable Object, clock, or browser dependency: canonical commands persist
 * its data, while this layer supplies replay-safe policy decisions.
 */

export const ANNUAL_2026_STAGE_ORDER = [
  'D_CAPTAIN',
  'D_LIEUTENANT',
  'ABC_CAPTAIN',
  'ABC_LIEUTENANT',
  'ABC_FIREFIGHTER',
] as const;

export type AnnualStageId = (typeof ANNUAL_2026_STAGE_ORDER)[number] | string;
export type ContactMethod = 'PHONE' | 'TEXT';
export type PreferenceSheetStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'FROZEN';
export type ContactTimingMode = 'HARD_MINIMUM' | 'TARGET' | 'OPERATOR_DISCRETION';

export interface AnnualOperationsPolicy {
  readonly v: 1;
  readonly stageOrder: readonly AnnualStageId[];
  readonly requiredTopologyPositionIds: readonly string[];
  readonly contact: {
    readonly minimumAttempts: number;
    readonly timingMode: ContactTimingMode;
    /** Null is intentional for operator-discretion policy; it is never a hidden 15-minute default. */
    readonly durationSeconds: number | null;
  };
  readonly aDay: {
    readonly combatGroups: readonly ['G1', 'G2', 'G3', 'G4'];
    readonly min: number;
    readonly max: number;
    readonly captainDcMax: number;
    readonly specialtyMaximums: Readonly<
      Record<'MARINE_ASSIGNED' | 'MARINE_FLOAT' | 'DE' | 'SWAT', number>
    >;
  };
}

export interface FrozenPreferenceSheet {
  readonly id: string;
  readonly memberId: number;
  readonly source: 'MEMBER_SUBMISSION' | 'OPERATOR_ENTERED';
  readonly submittedAtMs: number;
  readonly status: PreferenceSheetStatus;
  readonly positionIds: readonly string[];
  readonly aDays: readonly string[];
}

export type SpecialtyKind = 'DEDICATED_POSITION' | 'MEMBERSHIP_DISTRIBUTION';

export interface SpecialtyRule {
  readonly code:
    | 'FIRE_INVESTIGATOR'
    | 'MARINE_ASSIGNED'
    | 'MARINE_FLOAT'
    | 'SWAT'
    | 'RESCUE'
    | 'AIR_TECH_810'
    | 'DE';
  readonly kind: SpecialtyKind;
  /** Dedicated specialties require explicit topology; membership rules must not invent one. */
  readonly positionIds: readonly string[];
  readonly requiredCredentials: readonly string[];
}

export function evaluateSpecialtyEligibility(input: {
  rule: SpecialtyRule;
  credentialNames: readonly string[];
  positionId: string | null;
}): { ok: true } | { ok: false; code: string } {
  if (input.rule.kind === 'DEDICATED_POSITION') {
    if (input.rule.positionIds.length === 0)
      return { ok: false, code: 'SPECIALTY_TOPOLOGY_MISSING' };
    if (input.positionId === null || !input.rule.positionIds.includes(input.positionId))
      return { ok: false, code: 'SPECIALTY_POSITION_NOT_CONFIGURED' };
  } else if (input.rule.positionIds.length !== 0 || input.positionId !== null) {
    return { ok: false, code: 'MEMBERSHIP_SPECIALTY_MUST_NOT_INVENT_POSITION' };
  }
  const credentials = new Set(input.credentialNames);
  const missing = input.rule.requiredCredentials.some((credential) => !credentials.has(credential));
  return missing ? { ok: false, code: 'SPECIALTY_CREDENTIAL_REQUIRED' } : { ok: true };
}

export function validateSpecialtyADayMaximum(input: {
  specialty: 'MARINE_ASSIGNED' | 'MARINE_FLOAT' | 'DE' | 'SWAT';
  existingCount: number;
  policy: AnnualOperationsPolicy | undefined;
}): { ok: true } | { ok: false; code: string } {
  if (input.policy === undefined) return { ok: false, code: 'A_DAY_POLICY_MISSING' };
  const maximum = input.policy.aDay.specialtyMaximums[input.specialty];
  return input.existingCount < maximum
    ? { ok: true }
    : { ok: false, code: 'SPECIALTY_A_DAY_MAX_REACHED' };
}

export interface ContactAttempt {
  readonly memberId: number;
  readonly method: ContactMethod;
  readonly actorMemberId: number;
  readonly atMs: number;
}

export interface AnnualOperationsState {
  readonly preferenceSheets: readonly FrozenPreferenceSheet[];
  readonly contactAttempts: readonly ContactAttempt[];
  readonly unresolvedMemberIds: readonly number[];
  readonly returnedAtCurrentSequence: readonly {
    readonly memberId: number;
    readonly sequence: number;
  }[];
  /** A returned member is slotted at the active sequence without duplicating the frozen order. */
  readonly returningMemberId: number | null;
  readonly checkpoint: {
    readonly name: string;
    readonly createdAtMs: number;
    readonly actorMemberId: number;
    readonly sequence: number;
  } | null;
  readonly completion: {
    readonly readyForFinalizationAtMs: number;
    readonly actorMemberId: number;
  } | null;
}

export function initializeAnnualOperations(input: {
  preferenceSheets: readonly FrozenPreferenceSheet[];
}): AnnualOperationsState {
  return {
    preferenceSheets: input.preferenceSheets.map((sheet) => ({ ...sheet })),
    contactAttempts: [],
    unresolvedMemberIds: [],
    returnedAtCurrentSequence: [],
    returningMemberId: null,
    checkpoint: null,
    completion: null,
  };
}

export function validateAnnualOperationsReadiness(input: {
  operations: AnnualOperationsPolicy | undefined;
  bidYear: number;
  isMock: boolean;
  configuredStageIds: readonly string[];
  missingTopologyIds: readonly string[];
}): { ok: true } | { ok: false; code: string; detail?: string } {
  if (input.operations === undefined)
    return { ok: false, code: 'ANNUAL_OPERATIONS_POLICY_MISSING' };
  if (input.operations.stageOrder.length === 0)
    return { ok: false, code: 'ANNUAL_STAGE_ORDER_MISSING' };
  if (
    input.bidYear === 2026 &&
    (input.operations.stageOrder.length !== ANNUAL_2026_STAGE_ORDER.length ||
      input.operations.stageOrder.some(
        (stageId, index) => stageId !== ANNUAL_2026_STAGE_ORDER[index],
      ))
  )
    return { ok: false, code: 'ANNUAL_2026_STAGE_ORDER_INVALID' };
  const configured = new Set(input.configuredStageIds);
  if (input.operations.stageOrder.some((stageId) => !configured.has(stageId)))
    return { ok: false, code: 'ANNUAL_STAGE_POPULATION_INCOMPLETE' };
  if (!input.isMock && input.missingTopologyIds.length > 0)
    return {
      ok: false,
      code: 'ANNUAL_TOPOLOGY_INCOMPLETE',
      detail: input.missingTopologyIds.join(','),
    };
  if (input.operations.contact.minimumAttempts !== 3)
    return { ok: false, code: 'CONTACT_ATTEMPT_POLICY_INVALID' };
  if (
    input.operations.contact.timingMode !== 'OPERATOR_DISCRETION' &&
    (input.operations.contact.durationSeconds === null ||
      input.operations.contact.durationSeconds < 0)
  )
    return { ok: false, code: 'CONTACT_TIMER_POLICY_MISSING' };
  return { ok: true };
}

export function recordContactAttempt(
  state: AnnualOperationsState,
  attempt: ContactAttempt,
): { ok: true; state: AnnualOperationsState } | { ok: false; code: string } {
  if (attempt.method !== 'PHONE' && attempt.method !== 'TEXT')
    return { ok: false, code: 'CONTACT_METHOD_UNSUPPORTED' };
  const existing = state.contactAttempts.filter((item) => item.memberId === attempt.memberId);
  if (existing.length >= 3) return { ok: false, code: 'CONTACT_ATTEMPT_LIMIT_REACHED' };
  if (!Number.isInteger(attempt.atMs) || attempt.atMs < 0)
    return { ok: false, code: 'CONTACT_TIMESTAMP_INVALID' };
  return { ok: true, state: { ...state, contactAttempts: [...state.contactAttempts, attempt] } };
}

export function declareUnreachable(
  state: AnnualOperationsState,
  policy: AnnualOperationsPolicy | undefined,
  input: { memberId: number; actorMemberId: number },
): { ok: true; state: AnnualOperationsState } | { ok: false; code: string } {
  if (policy === undefined) return { ok: false, code: 'CONTACT_POLICY_MISSING' };
  const attempts = state.contactAttempts.filter((attempt) => attempt.memberId === input.memberId);
  if (attempts.length < policy.contact.minimumAttempts)
    return { ok: false, code: 'CONTACT_ATTEMPTS_INCOMPLETE' };
  if (state.unresolvedMemberIds.includes(input.memberId))
    return { ok: false, code: 'MEMBER_ALREADY_UNRESOLVED' };
  return {
    ok: true,
    state: { ...state, unresolvedMemberIds: [...state.unresolvedMemberIds, input.memberId] },
  };
}

export function returnAtCurrentSequence(
  state: AnnualOperationsState,
  input: { memberId: number; sequence: number },
): { ok: true; state: AnnualOperationsState } | { ok: false; code: string } {
  if (!state.unresolvedMemberIds.includes(input.memberId))
    return { ok: false, code: 'MEMBER_NOT_UNRESOLVED' };
  if (!Number.isInteger(input.sequence) || input.sequence < 0)
    return { ok: false, code: 'SEQUENCE_INVALID' };
  return {
    ok: true,
    state: {
      ...state,
      unresolvedMemberIds: state.unresolvedMemberIds.filter(
        (memberId) => memberId !== input.memberId,
      ),
      returnedAtCurrentSequence: [
        ...state.returnedAtCurrentSequence.filter((entry) => entry.memberId !== input.memberId),
        { memberId: input.memberId, sequence: input.sequence },
      ],
      returningMemberId: input.memberId,
    },
  };
}

export function evaluateNextPreference(input: {
  state: AnnualOperationsState;
  memberId: number;
  isPositionAvailable: (positionId: string) => boolean;
  validateADay: (positionId: string, aDay: string) => { ok: true } | { ok: false; code: string };
}):
  | { ok: true; preferenceSheetId: string; positionId: string; aDay: string }
  | { ok: false; code: string } {
  const sheet = input.state.preferenceSheets.find(
    (candidate) => candidate.memberId === input.memberId && candidate.status === 'FROZEN',
  );
  if (sheet === undefined) return { ok: false, code: 'FROZEN_PREFERENCE_SHEET_MISSING' };
  for (const positionId of sheet.positionIds) {
    if (!input.isPositionAvailable(positionId)) continue;
    for (const aDay of sheet.aDays) {
      const aDayResult = input.validateADay(positionId, aDay);
      if (aDayResult.ok) return { ok: true, preferenceSheetId: sheet.id, positionId, aDay };
    }
  }
  return { ok: false, code: 'NO_VALID_PREFERENCE_COMBINATION' };
}

export function upsertPreferenceSheet(
  state: AnnualOperationsState,
  sheet: FrozenPreferenceSheet,
): { ok: true; state: AnnualOperationsState } | { ok: false; code: string } {
  const existing = state.preferenceSheets.find(
    (candidate) => candidate.memberId === sheet.memberId,
  );
  if (existing?.status === 'FROZEN') return { ok: false, code: 'PREFERENCE_SHEET_FROZEN' };
  if (sheet.positionIds.length === 0 || sheet.aDays.length === 0)
    return { ok: false, code: 'PREFERENCE_SHEET_EMPTY' };
  return {
    ok: true,
    state: {
      ...state,
      preferenceSheets: [
        ...state.preferenceSheets.filter((candidate) => candidate.memberId !== sheet.memberId),
        { ...sheet },
      ],
    },
  };
}

export function checkpointAnnualOperations(
  state: AnnualOperationsState,
  checkpoint: NonNullable<AnnualOperationsState['checkpoint']>,
): AnnualOperationsState {
  return { ...state, checkpoint };
}

export function markReadyForFinalization(
  state: AnnualOperationsState,
  input: { actorMemberId: number; atMs: number; unresolvedMembersBlock: boolean },
): { ok: true; state: AnnualOperationsState } | { ok: false; code: string } {
  if (input.unresolvedMembersBlock && state.unresolvedMemberIds.length > 0)
    return { ok: false, code: 'UNRESOLVED_MEMBERS_BLOCK_COMPLETION' };
  return {
    ok: true,
    state: {
      ...state,
      completion: { actorMemberId: input.actorMemberId, readyForFinalizationAtMs: input.atMs },
    },
  };
}
