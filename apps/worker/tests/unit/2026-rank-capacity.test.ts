import { describe, expect, it } from 'vitest';
import { evaluate2026RankCapacity } from '../../src/lib/2026-rank-capacity.js';
import { buildCorrected2026SemanticRoles } from '../../src/lib/corrected-2026-semantic-roles.js';
import { buildCorrected2026Topology } from '../../src/lib/corrected-2026-topology.js';

const positions = buildCorrected2026Topology();
const participation = buildCorrected2026SemanticRoles().map((role) => ({
  positionId: role.positionId,
  bidParticipation:
    role.bidParticipation === 'BIDDABLE'
      ? ('BIDDABLE' as const)
      : ('ADMIN_ASSIGNED_NON_BIDDABLE' as const),
  authoritativeSourceRef: role.policyRef,
}));
const stages = [
  { id: 'days-captains', memberIds: [1, 2] },
  { id: 'days-lieutenants', memberIds: [101, 102] },
  { id: 'captains', memberIds: Array.from({ length: 22 }, (_, index) => index + 1) },
  { id: 'lieutenants', memberIds: Array.from({ length: 39 }, (_, index) => index + 101) },
  { id: 'firefighters', memberIds: Array.from({ length: 161 }, (_, index) => index + 201) },
];

describe('2026 rank-specific capacity gate', () => {
  it('detects the reviewed 39-Lieutenant versus 38-seat contradiction', () => {
    expect(evaluate2026RankCapacity({ positions, participation }, stages)).toEqual({
      capacity: { CPT: 23, LT: 38, FF: 162 },
      bidders: { CPT: 22, LT: 39, FF: 161 },
      shortages: [{ rank: 'LT', bidders: 39, capacity: 38 }],
    });
  });

  it('calculates the B703 rank-correction hypothesis without changing approved source', () => {
    const hypothetical = positions.map((position) =>
      position.id === 'B703' ? { ...position, rankRequired: 'LT' as const } : position,
    );
    expect(evaluate2026RankCapacity({ positions: hypothetical, participation }, stages)).toEqual({
      capacity: { CPT: 23, LT: 39, FF: 161 },
      bidders: { CPT: 22, LT: 39, FF: 161 },
      shortages: [],
    });
    expect(positions.find((position) => position.id === 'B703')?.rankRequired).toBe('FF');
  });
});
