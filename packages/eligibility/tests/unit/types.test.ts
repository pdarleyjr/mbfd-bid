import { describe, expectTypeOf, it } from 'vitest';
import type {
  Credential,
  EligibilityReason,
  EligibilityResult,
  Member,
  PointsBreakdown,
  PointsItem,
  PositionRule,
  TieBreakKey,
} from '../../src/types.js';

describe('types (structural)', () => {
  it('Member has required fields', () => {
    expectTypeOf<Member>().toHaveProperty('employeeId');
    expectTypeOf<Member>().toHaveProperty('rank');
    expectTypeOf<Member>().toHaveProperty('rscSeniority');
    expectTypeOf<Member>().toHaveProperty('rankSeniority');
    expectTypeOf<Member>().toHaveProperty('isProbationary');
    expectTypeOf<Member>().toHaveProperty('credentials');
  });

  it('Credential has a name field', () => {
    expectTypeOf<Credential>().toHaveProperty('name');
  });

  it('PointsItem has points, credential, requiresOpsPair, and an optional explicit ops gate', () => {
    expectTypeOf<PointsItem>().toHaveProperty('points');
    expectTypeOf<PointsItem>().toHaveProperty('credential');
    expectTypeOf<PointsItem>().toHaveProperty('requiresOpsPair');
    expectTypeOf<PointsItem>().toHaveProperty('opsGate');
  });

  it('EligibilityReason has code, label, satisfied', () => {
    expectTypeOf<EligibilityReason>().toHaveProperty('code');
    expectTypeOf<EligibilityReason>().toHaveProperty('label');
    expectTypeOf<EligibilityReason>().toHaveProperty('satisfied');
  });

  it('PointsBreakdown has total, soTotal, moTotal, itemized', () => {
    expectTypeOf<PointsBreakdown>().toHaveProperty('total');
    expectTypeOf<PointsBreakdown>().toHaveProperty('soTotal');
    expectTypeOf<PointsBreakdown>().toHaveProperty('moTotal');
    expectTypeOf<PointsBreakdown>().toHaveProperty('itemized');
  });

  it('PositionRule has requiredCriteria, pointsPreference, tieBreakChain', () => {
    expectTypeOf<PositionRule>().toHaveProperty('requiredCriteria');
    expectTypeOf<PositionRule>().toHaveProperty('pointsPreference');
    expectTypeOf<PositionRule>().toHaveProperty('tieBreakChain');
  });

  it('EligibilityResult has eligible, reasons, points, soPoints, moPoints, breakdown', () => {
    expectTypeOf<EligibilityResult>().toHaveProperty('eligible');
    expectTypeOf<EligibilityResult>().toHaveProperty('reasons');
    expectTypeOf<EligibilityResult>().toHaveProperty('points');
    expectTypeOf<EligibilityResult>().toHaveProperty('soPoints');
    expectTypeOf<EligibilityResult>().toHaveProperty('moPoints');
    expectTypeOf<EligibilityResult>().toHaveProperty('breakdown');
  });

  it('TieBreakKey union is exhaustive', () => {
    type Expected = 'points' | 'so_points' | 'mo_points' | 'rsc_seniority' | 'rank_seniority';
    expectTypeOf<TieBreakKey>().toEqualTypeOf<Expected>();
  });
});
