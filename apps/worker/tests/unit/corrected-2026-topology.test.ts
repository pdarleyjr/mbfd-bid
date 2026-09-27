import { describe, expect, it } from 'vitest';
import { evaluate2026OpportunityInventory } from '../../src/lib/2026-opportunity-inventory.js';
import {
  CORRECTED_2026_FLOAT_CAPTAIN_IDS,
  buildCorrected2026Topology,
} from '../../src/lib/corrected-2026-topology.js';

describe('corrected 2026 position topology', () => {
  it('adds one application-identified Combat Floating Captain per shift', () => {
    const positions = buildCorrected2026Topology();
    expect(positions).toHaveLength(231);
    for (const id of CORRECTED_2026_FLOAT_CAPTAIN_IDS) {
      expect(positions.find((position) => position.id === id)).toMatchObject({
        station: 'Combat Float Pool',
        unit: 'Combat Float',
        rankRequired: 'CPT',
        isFloating: true,
        isExcludedFromCount: false,
        canonicalIdentity: { identityOrigin: 'APPLICATION_CANONICAL' },
      });
    }
    const inventory = evaluate2026OpportunityInventory(
      positions.map((position) => ({
        id: position.id,
        shift: position.shift,
        rankRequired: position.rankRequired,
        bidParticipation: ['A211', 'B211', 'C211', 'A801', 'D201', 'D301', 'D401', 'D402'].includes(
          position.id,
        )
          ? 'ADMIN_ASSIGNED'
          : 'BIDDABLE',
        isExcludedFromCount: position.isExcludedFromCount,
      })),
    );
    expect(inventory.byShift).toEqual({ A: 73, B: 73, C: 73, D: 4 });
    expect(inventory.biddableDivisionChiefIds).toEqual([]);
    expect(inventory.blockingCodes).toEqual([]);
  });
});
