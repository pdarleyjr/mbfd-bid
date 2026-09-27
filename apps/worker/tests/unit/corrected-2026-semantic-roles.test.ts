import { describe, expect, it } from 'vitest';
import { buildCorrected2026SemanticRoles } from '../../src/lib/corrected-2026-semantic-roles.js';

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
});
