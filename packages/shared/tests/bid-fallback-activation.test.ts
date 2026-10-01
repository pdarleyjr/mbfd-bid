import { describe, expect, it } from 'vitest';
import { FrozenAnnualOperationsPolicySchema } from '../src/schemas/bid-policy';

function operations(activation?: unknown) {
  return {
    v: 1,
    stageOrder: ['ff'],
    requiredTopologyPositionIds: ['seat'],
    specialties: [],
    fallbackPolicies: [
      {
        id: 'source-fallback',
        label: 'Source fallback',
        sourceRef: 'Reviewed policy clause',
        sourceDecisionId: 'source-fallback',
        positionIds: ['seat'],
        ...(activation === undefined ? {} : { activation }),
        tiers: [
          {
            id: 'forced',
            label: 'Qualified reverse order',
            mode: 'FORCED',
            eligibility: { kind: 'MINIMUM_QUALIFIED' },
            currentlyAssignedOnly: false,
            comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
          },
        ],
      },
    ],
    contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
    aDay: {
      combatGroups: ['G1', 'G2', 'G3', 'G4'],
      min: 0,
      max: 10,
      captainDcMax: 1,
      specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
    },
  };
}

describe('versioned fallback activation condition', () => {
  it('preserves a source-backed condition through frozen policy parsing', () => {
    const activation = {
      v: 1,
      prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS',
      sourceRef: 'Reviewed July Procedure 3(e)(ii)',
    };
    expect(
      FrozenAnnualOperationsPolicySchema.parse(operations(activation)).fallbackPolicies?.[0],
    ).toMatchObject({ activation });
  });

  it('does not add a condition or change legacy configuration bytes when absent', () => {
    const legacy = operations();
    const parsed = FrozenAnnualOperationsPolicySchema.parse(legacy);
    expect(parsed.fallbackPolicies?.[0]).not.toHaveProperty('activation');
    expect(parsed).toEqual(legacy);
  });

  it.each([
    { v: 2, prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS', sourceRef: 'Reviewed policy' },
    { v: 1, prerequisite: 'OPERATOR_AUTHORIZED', sourceRef: 'Reviewed policy' },
    { v: 1, prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS', sourceRef: '' },
    {
      v: 1,
      prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS',
      sourceRef: 'Reviewed policy',
      exhausted: true,
    },
  ])('rejects unsupported, unsourced or client-asserted timing %j', (activation) => {
    expect(FrozenAnnualOperationsPolicySchema.safeParse(operations(activation)).success).toBe(
      false,
    );
  });
});
