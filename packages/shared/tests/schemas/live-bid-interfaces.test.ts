import { describe, expect, it } from 'vitest';
import {
  ADayCapacityContractSchema,
  AnnualCredentialEvaluationSchema,
  BidOpportunityImpactSchema,
  QualificationBulkReviewSchema,
  temporaryAssignmentBidEligibility,
} from '../../src/index.js';
describe('live bid downstream interfaces', () => {
  it('keeps missing annual evaluation explicitly pending', () =>
    expect(
      AnnualCredentialEvaluationSchema.parse({
        status: 'PENDING_CONFIGURATION',
        evaluationOn: null,
        policyReference: null,
      }).status,
    ).toBe('PENDING_CONFIGURATION'));
  it('forbids established snapshot mutation in impact projection', () =>
    expect(() =>
      BidOpportunityImpactSchema.parse({
        status: 'READY',
        effectiveOn: '2026-01-01',
        currentImpact: 'NONE',
        futureImpact: 'NONE',
        establishedSnapshotsAffected: true,
        sourceReference: 'x',
      }),
    ).toThrow());
  it('preserves import provenance and blocks external writeback', () =>
    expect(
      QualificationBulkReviewSchema.parse({
        v: 1,
        batchId: '00000000-0000-4000-8000-000000000001',
        sourceReference: 'import-1',
        externalWriteback: 'FORBIDDEN',
        rows: [
          {
            rowId: '1',
            idempotencyKey: '00000000-0000-4000-8000-000000000002',
            provenanceReference: 'row-1',
            outcome: 'PENDING',
            reason: null,
          },
        ],
      }).externalWriteback,
    ).toBe('FORBIDDEN'));
  it('fails temporary assignment eligibility closed', () =>
    expect(temporaryAssignmentBidEligibility(null, 'DETAIL')).toBe('UNRESOLVED'));
  it('represents category quotas and D-shift weekday/division capacity', () =>
    expect(
      ADayCapacityContractSchema.parse({
        v: 1,
        minimum: 1,
        maximum: 5,
        categoryQuotas: {
          CAPTAIN_DC: { min: 0, max: 2 },
          LIEUTENANT: { min: 0, max: 2 },
          MARINE_ASSIGNED: { min: 0, max: 2 },
          MARINE_FLOAT: { min: 0, max: 2 },
          DE: { min: 0, max: 2 },
          SWAT: { min: 0, max: 2 },
        },
        dShiftWeekdayCapacity: [{ divisionId: 'D1', weekday: 'MON', min: 1, max: 2 }],
      }).dShiftWeekdayCapacity,
    ).toHaveLength(1));
});
