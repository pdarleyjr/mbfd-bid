import type { BidSessionPolicySnapshot } from '@mbfd/shared';

type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

export interface FrozenNonBidAssignment {
  memberId: number;
  name: string;
  rank: string;
}

/** Display retained assignments only. Never creates fills, eligibility or Bid counts. */
export function projectFrozenNonBidAssignments(
  snapshot: Snapshot,
): Map<string, FrozenNonBidAssignment> {
  const positions = snapshot.ruleBookMaterial.positions.filter(
    (position) => position.bidParticipation !== 'BIDDABLE',
  );
  const positionIds = new Set(positions.map((position) => position.id));
  const candidates = new Map<string, typeof snapshot.members>();
  for (const member of snapshot.members) {
    const retained = (member.currentBidPositionIds ?? []).filter((id) => positionIds.has(id));
    for (const id of retained) candidates.set(id, [...(candidates.get(id) ?? []), member]);
  }
  const assignments = new Map<string, FrozenNonBidAssignment>();
  for (const position of positions) {
    if (positions.filter((entry) => entry.id === position.id).length !== 1) continue;
    const matches = candidates.get(position.id) ?? [];
    if (matches.length !== 1) continue;
    const member = matches[0];
    if (
      !member ||
      snapshot.members.filter((entry) => entry.memberId === member.memberId).length !== 1
    )
      continue;
    // A member claiming several fixed slots cannot establish one retained seat.
    if ((member.currentBidPositionIds ?? []).filter((id) => positionIds.has(id)).length !== 1)
      continue;
    const identities = (snapshot.operatorIdentityProjection ?? []).filter(
      (identity) => identity.memberId === member.memberId,
    );
    const identity = identities.length === 1 ? identities[0] : undefined;
    if (
      !identity ||
      identity.rank !== member.rank ||
      !identity.firstName.trim() ||
      !identity.lastName.trim()
    )
      continue;
    assignments.set(position.id, {
      memberId: member.memberId,
      name: `${identity.firstName} ${identity.lastName}`,
      rank: identity.rank,
    });
  }
  return assignments;
}
