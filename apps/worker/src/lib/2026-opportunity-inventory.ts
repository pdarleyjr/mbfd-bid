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

/** Evaluate exact frozen seats. An overall total cannot conceal a Chief seat. */
export function evaluate2026OpportunityInventory(
  positions: readonly OpportunityInventoryPosition[],
): OpportunityInventory2026 {
  const byShift = { A: 0, B: 0, C: 0, D: 0 };
  const biddableDivisionChiefIds: string[] = [];
  const blockingCodes: string[] = [];
  const ids = new Set<string>();
  for (const position of positions) {
    if (ids.has(position.id)) blockingCodes.push(`duplicate_position:${position.id}`);
    ids.add(position.id);
    if (position.bidParticipation !== 'BIDDABLE' || position.isExcludedFromCount === true) continue;
    if (position.rankRequired === 'DC' || ['A211', 'B211', 'C211'].includes(position.id)) {
      biddableDivisionChiefIds.push(position.id);
    }
    if (position.shift in byShift) {
      byShift[position.shift as keyof typeof byShift] += 1;
    } else {
      blockingCodes.push(`unsupported_shift:${position.id}`);
    }
  }
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
