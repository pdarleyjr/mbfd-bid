import { describe, expect, it } from 'vitest';
import { map2026VersionPositionsByRole } from '../../src/lib/corrected-2026-successor.js';
import { buildCorrected2026Topology } from '../../src/lib/corrected-2026-topology.js';

const source = buildCorrected2026Topology().filter(
  (position) => position.canonicalIdentity === undefined,
);
const previous = source.map((position) => ({
  id: `prior-${position.id}`,
  shift: position.shift,
  station: position.station,
  division:
    position.station === 'Station #2' &&
    position.unit === 'Float 2' &&
    position.positionName === 'Firefighter #1 (C)' &&
    ['B', 'C'].includes(position.shift)
      ? 'Rescue'
      : position.division,
  unit:
    position.station === 'Station #3' && position.positionName.includes('INV')
      ? 'Ladder 3'
      : String(position.unit),
  rankRequired: position.rankRequired,
  positionName: position.positionName,
  isFloating: position.isFloating,
  isVacantByDesign: position.isVacantByDesign,
  isExcludedFromCount: position.isExcludedFromCount,
}));

describe('2026 successor semantic position mapping', () => {
  it('matches every MASTER role after approved source corrections, independent of prior IDs and row order', () => {
    const result = map2026VersionPositionsByRole(previous.reverse());
    expect(result.size).toBe(228);
    expect(new Set(result.values()).size).toBe(228);
    expect(result.get('prior-A305')).toBe('A305');
    expect(result.get('prior-B214')).toBe('B214');
    expect(result.get('prior-A211')).toBe('A211');
  });

  it('fails closed when a prior role cannot be reconciled', () => {
    const changed = previous.map((position) =>
      position.id === 'prior-A305'
        ? { ...position, positionName: 'Unreviewed Investigator' }
        : position,
    );
    expect(() => map2026VersionPositionsByRole(changed)).toThrow(
      'corrected_2026_semantic_role_mismatch',
    );
  });
});
