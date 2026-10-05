/** Read-only projection from the existing authenticated specialty-live response.
 * The browser never infers qualification, scoring or specialty order. */
export type OperatorSpecialtyCandidate = {
  memberId: number;
  priority: number | null;
  points: number | null;
  eligiblePositionIds: readonly string[];
  available: boolean;
};

export type OperatorSpecialtyGroup = {
  id: string;
  label: string;
  positionIds: readonly string[];
  candidates: readonly OperatorSpecialtyCandidate[];
  remainingSeatCount: number | null;
  eligibleMemberCount: number;
  status: 'FEASIBLE' | 'LOW_BUFFER' | 'SHORTAGE' | null;
  criticalMemberIds: readonly number[];
  rankingAvailable: boolean;
  dataBlockedMemberIds: readonly number[];
  rankingCode?: string;
};

export type OperatorSpecialtyRoster = {
  sessionId: string;
  sequence: number;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  groups: readonly OperatorSpecialtyGroup[];
  combinedShortage: number | null;
  code?: string;
};

export function specialtyCoverageWarnings(roster: OperatorSpecialtyRoster | null) {
  return roster?.availability === 'AVAILABLE'
    ? roster.groups.filter(
        (group) =>
          group.remainingSeatCount !== null &&
          group.remainingSeatCount > 0 &&
          (group.status === 'LOW_BUFFER' || group.status === 'SHORTAGE'),
      )
    : [];
}
