import { describe, expect, it } from 'vitest';
import { evaluate2026OpportunityInventory } from '../../src/lib/2026-opportunity-inventory.js';

const seats = (ordinaryPerShift: number, chiefParticipation: string) => [
  ...(['A', 'B', 'C'] as const).flatMap((shift) => [
    ...Array.from({ length: ordinaryPerShift }, (_, index) => ({
      id: `${shift}${String(index + 300).padStart(3, '0')}`,
      shift,
      rankRequired: 'FF',
      bidParticipation: 'BIDDABLE',
    })),
    { id: `${shift}211`, shift, rankRequired: 'DC', bidParticipation: chiefParticipation },
  ]),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `D${String(index + 101).padStart(3, '0')}`,
    shift: 'D',
    rankRequired: 'CPT',
    bidParticipation: 'BIDDABLE',
  })),
];

describe('2026 opportunity inventory', () => {
  it('rejects a superficially correct 223 total when a Chief fills each 73-seat shift', () => {
    const result = evaluate2026OpportunityInventory(seats(72, 'BIDDABLE'));
    expect(result.total).toBe(223);
    expect(result.byShift).toEqual({ A: 73, B: 73, C: 73, D: 4 });
    expect(result.biddableDivisionChiefIds).toEqual(['A211', 'B211', 'C211']);
    expect(result.blockingCodes).toContain('division_chief_biddable:A211,B211,C211');
  });

  it('accepts 73 real Bid seats per shift with separate non-biddable Chief identities', () => {
    const result = evaluate2026OpportunityInventory(seats(73, 'ADMIN_ASSIGNED_NON_BIDDABLE'));
    expect(result.total).toBe(223);
    expect(result.blockingCodes).toEqual([]);
  });
});
