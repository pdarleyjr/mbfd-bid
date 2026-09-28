import { describe, expect, it } from 'vitest';
import {
  FINAL_2026_TOPOLOGY_DECISION_ID,
  FINAL_2026_TOPOLOGY_SOURCE_REF,
  evaluate2026OpportunityInventory,
  isFinal2026ManagedConfiguration,
} from '../../src/lib/2026-opportunity-inventory.js';

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
  it('scopes the final production gate by immutable reviewed source provenance', () => {
    const sourceDecisions = [
      {
        issueId: FINAL_2026_TOPOLOGY_DECISION_ID,
        area: 'positions',
        status: 'RESOLVED',
        sourceRef: FINAL_2026_TOPOLOGY_SOURCE_REF,
      },
    ];
    expect(isFinal2026ManagedConfiguration(2026, { sourceDecisions })).toBe(true);
    expect(isFinal2026ManagedConfiguration(2026, {})).toBe(false);
    expect(
      isFinal2026ManagedConfiguration(2026, {
        sourceDecisions: sourceDecisions.map((decision) => ({ ...decision, status: 'OPEN' })),
      }),
    ).toBe(false);
    expect(isFinal2026ManagedConfiguration(2027, { sourceDecisions })).toBe(false);
    expect(isFinal2026ManagedConfiguration(2026, { sourceTemplateVersion: '2026.final.1' })).toBe(
      true,
    );
  });

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

  it('rejects each biddable Chief even when excluded from numerical capacity', () => {
    const hiddenChiefs = seats(73, 'BIDDABLE').map((position) =>
      position.rankRequired === 'DC' ? { ...position, isExcludedFromCount: true } : position,
    );
    const result = evaluate2026OpportunityInventory(hiddenChiefs);
    expect(result.byShift).toEqual({ A: 73, B: 73, C: 73, D: 4 });
    expect(result.biddableDivisionChiefIds).toEqual(['A211', 'B211', 'C211']);
    expect(result.blockingCodes).toContain('division_chief_biddable:A211,B211,C211');
  });

  it('rejects Union President and closed Days rows even when excluded from capacity', () => {
    const hiddenProtected = [
      ...seats(73, 'ADMIN_ASSIGNED_NON_BIDDABLE'),
      ...['A801', 'D201', 'D301', 'D401', 'D402'].map((id) => ({
        id,
        shift: id[0] ?? 'D',
        rankRequired: 'CPT',
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: true,
      })),
    ];
    const result = evaluate2026OpportunityInventory(hiddenProtected);
    expect(result.byShift).toEqual({ A: 73, B: 73, C: 73, D: 4 });
    expect(result.blockingCodes).toContain(
      'protected_2026_position_biddable:A801,D201,D301,D401,D402',
    );
  });
});
