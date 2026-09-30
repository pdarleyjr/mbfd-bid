/** A reviewed, unverified assertion withholds only that qualification. A
 * later approved dated qualification event can resolve it; this is neither
 * an invented expiration nor a revocation of the preserved source. */
export function unresolvedQualificationHolds(
  rows: readonly {
    memberId: number;
    credentialId: number;
    credentialName: string;
    reviewedAt: number;
    observedOn: string;
  }[],
  events: readonly {
    memberId: number;
    credentialId: number | null;
    createdAt: number;
    effectiveOn: string;
  }[],
  asOf: string,
) {
  return rows.filter(
    (row) =>
      row.observedOn <= asOf &&
      !events.some(
        (event) =>
          event.memberId === row.memberId &&
          event.credentialId === row.credentialId &&
          event.createdAt > row.reviewedAt &&
          event.effectiveOn <= asOf,
      ),
  );
}
