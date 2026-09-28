import { describe, expect, it } from 'vitest';
import {
  buildCorrected2026SemanticRoles,
  corrected2026Role,
} from '../../src/lib/corrected-2026-semantic-roles.js';
import { buildCorrected2026Topology } from '../../src/lib/corrected-2026-topology.js';

describe('corrected 2026 role reconciliation', () => {
  it('classifies every organizational profile and all 223 Bid opportunities', () => {
    const roles = buildCorrected2026SemanticRoles();
    expect(roles).toHaveLength(231);
    expect(new Set(roles.map((role) => role.positionId)).size).toBe(231);
    expect(roles.filter((role) => role.bidParticipation === 'BIDDABLE')).toHaveLength(223);
    expect(roles.filter((role) => role.ruleReview === 'REQUIRED')).toHaveLength(223);
    expect(roles.filter((role) => role.bidParticipation === 'ADMIN_ASSIGNED')).toHaveLength(4);
    expect(roles.filter((role) => role.bidParticipation === 'CLOSED')).toHaveLength(4);
    expect(
      roles
        .filter((role) => role.roleFamily === 'COMBAT_FLOAT_CAPTAIN')
        .map((role) => role.positionId),
    ).toEqual(['A718', 'B718', 'C718']);
    expect(
      roles
        .filter((role) => role.roleFamily === 'FIRE_INVESTIGATOR')
        .map((role) => role.positionId),
    ).toEqual(['A305', 'B305', 'C305']);
    expect(
      roles.filter((role) => role.roleFamily === 'AIR_TECH').map((role) => role.positionId),
    ).toEqual(['A203', 'B203', 'C203']);
  });

  it('uses role facts rather than numeric suffixes for Marine and canonical Float Captain', () => {
    const positions = buildCorrected2026Topology();
    const operator = positions.find((position) => position.id === 'A602');
    const captain = positions.find((position) => position.id === 'A718');
    if (!operator || !captain) throw new Error('Reviewed source roles missing');
    expect(corrected2026Role({ ...operator, id: 'A699' }).roleFamily).toBe('MARINE_OPERATOR');
    expect(corrected2026Role({ ...captain, id: 'A799' }).roleFamily).toBe('COMBAT_FLOAT_CAPTAIN');
  });

  it('keeps the reviewed B Rescue Float ranks and source correction distinct from raw MASTER', () => {
    const positions = buildCorrected2026Topology();
    const roles = buildCorrected2026SemanticRoles();
    for (const [id, rank, name, family] of [
      ['B703', 'LT', 'Lieutenant #3 (R)', 'RESCUE_FLOAT_LT'],
      ['B704', 'FF', 'Firefighter #1', 'RESCUE_FLOAT_FF'],
      ['B705', 'FF', 'Firefighter #2', 'RESCUE_FLOAT_FF'],
      ['B706', 'FF', 'Firefighter #3', 'RESCUE_FLOAT_FF'],
    ]) {
      const position = positions.find((item) => item.id === id);
      const role = roles.find((item) => item.positionId === id);
      expect(position?.rankRequired).toBe(rank);
      expect(position?.positionName).toBe(name);
      expect(position?.source?.correction).toContain('2026-b-rescue-float-rank-correction');
      expect(role?.roleFamily).toBe(family);
    }
  });
});
