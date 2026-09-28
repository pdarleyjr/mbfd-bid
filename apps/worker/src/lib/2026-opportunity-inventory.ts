export interface OpportunityInventoryPosition {
  id: string;
  shift: string;
  rankRequired: string;
  bidParticipation: string;
  isExcludedFromCount?: boolean;
}

export interface OpportunityInventory2026 {
  byShift: Record<'A' | 'B' | 'C' | 'D', number>;
  total: number;
  biddableDivisionChiefIds: string[];
  blockingCodes: string[];
}

/** A resolved source decision is copied into each immutable Bid definition.
 * The source identity, not a coincidental position ID, opts the corrected
 * final topology into its strict 73-seat inventory contract. */
export const FINAL_2026_TOPOLOGY_DECISION_ID = '2026-reviewed-final-topology';
export const FINAL_2026_TOPOLOGY_SOURCE_REF =
  'MASTER 2026 Bid Positions Selection V2.xlsx sha256:0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a; administrator direct review 2025 A/B/C diagrams 2026-09-27';

export interface Final2026TopologyProvenance {
  sourceDecisions?: readonly {
    issueId: string;
    area: string;
    status: string;
    sourceRef: string;
  }[];
  sourceTemplateVersion?: string | undefined;
}

export function isFinal2026ManagedConfiguration(
  year: number,
  provenance: Final2026TopologyProvenance,
): boolean {
  if (year !== 2026) return false;
  return (
    provenance.sourceTemplateVersion === '2026.final.1' ||
    (provenance.sourceDecisions ?? []).some(
      (decision) =>
        decision.issueId === FINAL_2026_TOPOLOGY_DECISION_ID &&
        decision.area === 'positions' &&
        decision.status === 'RESOLVED' &&
        decision.sourceRef === FINAL_2026_TOPOLOGY_SOURCE_REF,
    )
  );
}

/** Chief exclusion applies to every new 2026 run, including older versions
 * without the corrected topology decision. Frozen historical reads remain intact. */
export function biddable2026DivisionChiefIds(
  positions: readonly OpportunityInventoryPosition[],
): string[] {
  return positions
    .filter(
      (position) =>
        position.bidParticipation === 'BIDDABLE' &&
        (position.rankRequired === 'DC' || ['A211', 'B211', 'C211'].includes(position.id)),
    )
    .map((position) => position.id);
}

/** Evaluate exact frozen seats. An overall total cannot conceal a Chief seat. */
export function evaluate2026OpportunityInventory(
  positions: readonly OpportunityInventoryPosition[],
): OpportunityInventory2026 {
  const byShift = { A: 0, B: 0, C: 0, D: 0 };
  const biddableDivisionChiefIds: string[] = [];
  const biddableProtectedIds: string[] = [];
  const blockingCodes: string[] = [];
  const ids = new Set<string>();
  const chiefIds = ['A211', 'B211', 'C211'];
  const protectedIds = ['A801', 'D201', 'D301', 'D401', 'D402'];
  for (const position of positions) {
    if (ids.has(position.id)) blockingCodes.push(`duplicate_position:${position.id}`);
    ids.add(position.id);
    // Participation is independent of count exclusion: a Chief must not be
    // offered in a Bid even if a count flag hides that row from the total.
    if (
      position.bidParticipation === 'BIDDABLE' &&
      (position.rankRequired === 'DC' || chiefIds.includes(position.id))
    ) {
      biddableDivisionChiefIds.push(position.id);
    }
    if (position.bidParticipation === 'BIDDABLE' && protectedIds.includes(position.id)) {
      biddableProtectedIds.push(position.id);
    }
    if (position.bidParticipation !== 'BIDDABLE' || position.isExcludedFromCount === true) continue;
    if (position.shift in byShift) {
      byShift[position.shift as keyof typeof byShift] += 1;
    } else {
      blockingCodes.push(`unsupported_shift:${position.id}`);
    }
  }
  const missingChiefIds = chiefIds.filter((id) => !ids.has(id));
  if (missingChiefIds.length > 0)
    blockingCodes.push(`division_chief_missing:${missingChiefIds.join(',')}`);
  for (const shift of ['A', 'B', 'C'] as const) {
    if (byShift[shift] !== 73)
      blockingCodes.push(`${shift}_shift_count:${byShift[shift]}:expected_73`);
  }
  if (biddableDivisionChiefIds.length > 0) {
    blockingCodes.push(`division_chief_biddable:${biddableDivisionChiefIds.join(',')}`);
  }
  if (biddableProtectedIds.length > 0) {
    blockingCodes.push(`protected_2026_position_biddable:${biddableProtectedIds.join(',')}`);
  }
  return {
    byShift,
    total: Object.values(byShift).reduce((sum, count) => sum + count, 0),
    biddableDivisionChiefIds,
    blockingCodes,
  };
}
