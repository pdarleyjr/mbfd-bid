export type TemporaryAssignmentKind =
  | 'SPECIAL_ASSIGNMENT'
  | 'LIGHT_DUTY'
  | 'TEMPORARY_DUTY'
  | 'DETAIL'
  | 'EXECUTIVE_ASSIGNMENT'
  | 'TEMPORARY_A_DAY_CHANGE';
export interface TemporaryOverlayInput {
  kind: TemporaryAssignmentKind;
  memberId: number;
  underlyingAssignmentId: string;
  underlyingPositionId: string;
  temporaryPositionId: string;
  effectiveOn: string;
  plannedEndOn: string | null;
}

/**
 * Local adapter seam. It never persists or changes canonical assignments.
 * Only Command Staff-confirmed overlay semantics are represented here.
 */
export function previewTemporaryOverlay(input: TemporaryOverlayInput) {
  if (input.kind !== 'SPECIAL_ASSIGNMENT' && input.kind !== 'LIGHT_DUTY')
    return { ok: false as const, error: 'TEMPORARY_ASSIGNMENT_POLICY_PENDING' as const };
  return {
    ok: true as const,
    kind: input.kind,
    memberId: input.memberId,
    effectiveOn: input.effectiveOn,
    plannedEndOn: input.plannedEndOn,
    underlyingAssignmentId: input.underlyingAssignmentId,
    underlyingPositionId: input.underlyingPositionId,
    temporaryOperationalAssignment: input.temporaryPositionId,
    underlyingBidAssignmentPreserved: true,
    aDayPreserved: true,
    memberRemainsBidEligible: true,
    dailyVacancy: { positionId: input.underlyingPositionId, bidVacancy: false },
    temporaryDestinationStaffingCount: 'POLICY_PENDING' as const,
    automaticReturn: 'ON_END_OR_CLEARANCE' as const,
    establishedBidSnapshotImpact: 'NONE' as const,
  };
}
