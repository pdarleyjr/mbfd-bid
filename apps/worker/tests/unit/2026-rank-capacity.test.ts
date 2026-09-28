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
  it('reconciles the reviewed final cohort with one expected Captain vacancy', () => {
    expect(evaluate2026RankCapacity({ positions, participation }, stages)).toEqual({
      capacity: { CPT: 23, LT: 39, FF: 161 },
      bidders: { CPT: 22, LT: 39, FF: 161 },
      expectedVacancies: { CPT: 1, LT: 0, FF: 0 },
      shortages: [],
    });
  });

  it('requires a rank-compatible seat for every bidder', () => {
    const invalid = positions.map((position) =>
      position.id === 'B703' ? { ...position, rankRequired: 'FF' as const } : position,
    );
    expect(
      evaluate2026RankCapacity({ positions: invalid, participation }, stages).shortages,
    ).toEqual([{ rank: 'LT', bidders: 39, capacity: 38 }]);
  });
});
