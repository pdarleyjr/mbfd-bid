import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../src/evaluate.js';
import type { Member, PositionRule } from '../src/types.js';

const member: Member = {
  employeeId: 'synthetic',
  firstName: '',
  lastName: '',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: [{ name: 'Operation' }, { name: 'Technician' }, { name: 'Reviewed alternate' }],
};
const base: PositionRule = {
  positionId: 'test',
  ruleBookVersion: '2028.1',
  requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
  pointsPreference: { max: 0, items: [] },
  tieBreakChain: ['points', 'so_points'],
};

describe('versioned configurable scoring', () => {
  it('requires reviewed cumulative service and never invents credit from credentials', () => {
    const rule = {
      ...base,
      requiredCriteria: {
        ...base.requiredCriteria,
        service: [{ serviceCode: 'RESCUE_DIVISION', minimumMonths: 36 }],
      },
    };
    expect(evaluateEligibility(member, rule)).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'service_evidence_unknown' }),
      ]),
    });
    const credit = {
      serviceCode: 'RESCUE_DIVISION',
      verifiedMonths: 36,
      effectiveOn: '2026-01-01',
      recordId: 'synthetic-record',
      sourceRef: 'synthetic source',
      actorSubject: 'synthetic-actor',
    };
    expect(evaluateEligibility({ ...member, serviceCredits: [credit] }, rule).eligible).toBe(true);
    expect(
      evaluateEligibility({ ...member, serviceCredits: [{ ...credit, verifiedMonths: 35 }] }, rule)
        .eligible,
    ).toBe(false);
    expect(
      evaluateEligibility(
        { ...member, serviceCredits: [{ ...credit, verifiedMonths: null }] },
        rule,
      ).eligible,
    ).toBe(false);
    expect(
      evaluateEligibility({ ...member, serviceCredits: [credit, credit] }, rule).eligible,
    ).toBe(false);
  });
  it('requires one reviewed qualification from every alternative group in addition to all prerequisites', () => {
    const rule = {
      ...base,
      requiredCriteria: {
        ...base.requiredCriteria,
        credentials: ['Operation'],
        anyOfCredentials: [
          ['Unheld primary', 'Reviewed alternate'],
          ['Technician', 'Another alternate'],
        ],
      },
    };
    expect(evaluateEligibility(member, rule).eligible).toBe(true);
    expect(
      evaluateEligibility(
        { ...member, credentials: [{ name: 'Operation' }, { name: 'Reviewed alternate' }] },
        rule,
      ).eligible,
    ).toBe(false);
    expect(
      evaluateEligibility(
        { ...member, credentials: [{ name: 'Technician' }, { name: 'Reviewed alternate' }] },
        rule,
      ).eligible,
    ).toBe(false);
    expect(
      evaluateEligibility(member, {
        ...rule,
        requiredCriteria: { ...rule.requiredCriteria, anyOfCredentials: [[]] },
      }).eligible,
    ).toBe(false);
  });
  it('uses explicit groups, prerequisites, alternatives and caps for each ranking channel', () => {
    const rule = {
      ...base,
      pointsPreference: {
        ...base.pointsPreference,
        scoring: {
          v: 1 as const,
          total: [
            {
              id: 'skill',
              cap: 2,
              items: [
                { credential: 'Operation', alternatives: [], requiresAll: [], points: 1 },
                {
                  credential: 'Technician',
                  alternatives: [],
                  requiresAll: ['Operation'],
                  points: 2,
                },
              ],
            },
          ],
          so: [
            {
              id: 'so',
              cap: null,
              items: [
                {
                  credential: 'New skill',
                  alternatives: ['Reviewed alternate'],
                  requiresAll: [],
                  points: 7,
                },
              ],
            },
          ],
          mo: [],
        },
      },
    };
    expect(evaluateEligibility(member, rule)).toMatchObject({
      eligible: true,
      points: 2,
      soPoints: 7,
      moPoints: 0,
    });
    expect(
      evaluateEligibility({ ...member, credentials: [{ name: 'Technician' }] }, rule),
    ).toMatchObject({ points: 0 });
    expect(evaluateEligibility({ ...member, rank: 'CPT' }, rule)).toMatchObject({
      eligible: false,
      points: 0,
      soPoints: 0,
    });
  });
});
