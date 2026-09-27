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

/** Saved Bid definitions mint numeric template aliases. A801 is the preserved
 * organizational profile unique to the final MASTER topology; legacy 2026
 * templates used A701. This immutable content marker distinguishes the final
 * production topology from minimal same-year policy fixtures. */
export function isFinal2026ManagedConfiguration(
  year: number,
  positions: readonly Pick<OpportunityInventoryPosition, 'id'>[],
): boolean {
  return year === 2026 && positions.some((position) => position.id === 'A801');
}

/** Evaluate exact frozen seats. An overall total cannot conceal a Chief seat. */
export function evaluate2026OpportunityInventory(
  positions: readonly OpportunityInventoryPosition[],
): OpportunityInventory2026 {
  const byShift = { A: 0, B: 0, C: 0, D: 0 };
  const biddableDivisionChiefIds: string[] = [];
  const blockingCodes: string[] = [];
  const ids = new Set<string>();
  const chiefIds = ['A211', 'B211', 'C211'];
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
  return {
    byShift,
    total: Object.values(byShift).reduce((sum, count) => sum + count, 0),
    biddableDivisionChiefIds,
    blockingCodes,
  };
}
