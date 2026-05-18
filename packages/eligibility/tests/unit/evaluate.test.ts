import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../../src/evaluate.js';
import type { Member, PositionRule } from '../../src/types.js';

const lt: Member = {
  employeeId: '20731',
  firstName: 'Peter',
  lastName: 'Darley',
  rank: 'LT',
  rscSeniority: 75,
  rankSeniority: 20,
  isProbationary: false,
  credentials: [
    { name: 'Hazardous Materials Operations' },
    { name: 'Rope Rescue Operations' },
    { name: 'Confined Space Operations' },
    { name: 'Structural Collapse Operations' },
    { name: 'Trench Rescue Operations' },
    { name: 'Vehicle & Machinery Rescue Operations' },
    { name: 'State Certified Hazardous Materials Technician' },
    { name: 'Rope Rescue Technician' },
    { name: 'Confined Space Technician' },
    { name: 'Structural Collapse Technician' },
    { name: 'Trench Rescue Technician' },
    { name: 'Vehicle & Machinery Rescue Technician' },
    { name: 'Drone Operator Qualified-Part 107 sUAS' },
    { name: 'Paramedic' },
  ],
};

const rescueLtRule: PositionRule = {
  positionId: 'A205',
  ruleBookVersion: '2026.1',
  requiredCriteria: {
    rank: ['LT'],
    credentials: [],
    custom: ['paramedic', 'non_probationary'],
  },
  pointsPreference: {
    max: 13,
    items: [
      { points: 1, credential: 'Hazardous Materials Operations', requiresOpsPair: false },
      { points: 1, credential: 'Rope Rescue Operations', requiresOpsPair: false },
      { points: 1, credential: 'Confined Space Operations', requiresOpsPair: false },
      { points: 1, credential: 'Structural Collapse Operations', requiresOpsPair: false },
      { points: 1, credential: 'Trench Rescue Operations', requiresOpsPair: false },
      { points: 1, credential: 'Vehicle & Machinery Rescue Operations', requiresOpsPair: false },
      {
        points: 1,
        credential: 'State Certified Hazardous Materials Technician',
        requiresOpsPair: true,
      },
      { points: 1, credential: 'Rope Rescue Technician', requiresOpsPair: true },
      { points: 1, credential: 'Confined Space Technician', requiresOpsPair: true },
      { points: 1, credential: 'Structural Collapse Technician', requiresOpsPair: true },
      { points: 1, credential: 'Trench Rescue Technician', requiresOpsPair: true },
      { points: 1, credential: 'Vehicle & Machinery Rescue Technician', requiresOpsPair: true },
      { points: 1, credential: 'Drone Operator Qualified-Part 107 sUAS', requiresOpsPair: false },
    ],
  },
  tieBreakChain: ['points', 'so_points', 'rsc_seniority', 'rank_seniority'],
};

const cptRule: PositionRule = {
  positionId: 'A201',
  ruleBookVersion: '2026.1',
  requiredCriteria: { rank: ['CPT'], credentials: [], custom: [] },
  pointsPreference: { max: 0, items: [] },
  tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
};

describe('evaluateEligibility', () => {
  it('LT with Paramedic is eligible for Rescue LT position', () => {
    const result = evaluateEligibility(lt, rescueLtRule);
    expect(result.eligible).toBe(true);
  });

  it('eligible member scores 13 points (6 ops + 6 tech + 1 drone, capped at 13)', () => {
    const result = evaluateEligibility(lt, rescueLtRule);
    expect(result.points).toBe(13);
  });

  it('eligible member scores 13 SO points', () => {
    const result = evaluateEligibility(lt, rescueLtRule);
    expect(result.soPoints).toBe(13);
  });

  it('reasons array contains at least one entry per required criterion', () => {
    const result = evaluateEligibility(lt, rescueLtRule);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => typeof r.code === 'string')).toBe(true);
  });

  it('all reasons satisfied = true for fully eligible member', () => {
    const result = evaluateEligibility(lt, rescueLtRule);
    expect(result.reasons.every((r) => r.satisfied)).toBe(true);
  });

  it('LT fails CPT-required position — eligible false', () => {
    const result = evaluateEligibility(lt, cptRule);
    expect(result.eligible).toBe(false);
    expect(result.points).toBe(0);
    expect(result.soPoints).toBe(0);
  });

  it('ineligible result has at least one unsatisfied reason', () => {
    const result = evaluateEligibility(lt, cptRule);
    expect(result.reasons.some((r) => !r.satisfied)).toBe(true);
  });

  it('probationary LT fails non_probationary custom gate', () => {
    const probMember: Member = { ...lt, isProbationary: true };
    const result = evaluateEligibility(probMember, rescueLtRule);
    expect(result.eligible).toBe(false);
    expect(result.reasons.find((r) => r.code === 'PROBATIONARY_RESTRICTED')).toBeDefined();
  });

  it('FF without Paramedic fails paramedic custom gate', () => {
    const ff: Member = { ...lt, rank: 'FF', credentials: [] };
    const ffRule: PositionRule = {
      ...rescueLtRule,
      positionId: 'A206',
      requiredCriteria: { rank: ['FF'], credentials: [], custom: ['paramedic'] },
    };
    const result = evaluateEligibility(ff, ffRule);
    expect(result.eligible).toBe(false);
    expect(result.reasons.find((r) => r.code === 'PARAMEDIC_REQUIRED')).toBeDefined();
  });

  it('returns zero points for ineligible member even if credentials match', () => {
    const result = evaluateEligibility(lt, cptRule);
    expect(result.points).toBe(0);
    expect(result.soPoints).toBe(0);
    expect(result.moPoints).toBe(0);
  });

  it('member with required cred missing from requiredCriteria list fails', () => {
    const rule: PositionRule = {
      positionId: 'X611',
      ruleBookVersion: '2026.1',
      requiredCriteria: {
        rank: ['FF'],
        credentials: ['Merchant Mariner Credential (MMC)', 'IADRS Swim Evaluation'],
        custom: [],
      },
      pointsPreference: { max: 0, items: [] },
      tieBreakChain: ['points', 'mo_points', 'rsc_seniority', 'rank_seniority'],
    };
    const ff: Member = {
      employeeId: '55555',
      firstName: 'X',
      lastName: 'Y',
      rank: 'FF',
      rscSeniority: 100,
      rankSeniority: 50,
      isProbationary: false,
      credentials: [{ name: 'Merchant Mariner Credential (MMC)' }],
    };
    const result = evaluateEligibility(ff, rule);
    expect(result.eligible).toBe(false);
    expect(
      result.reasons.find((r) => r.code === 'CRED_MISSING' && r.label.includes('IADRS')),
    ).toBeDefined();
  });

  it('driver_engineer custom gate is evaluated when present', () => {
    const deRule: PositionRule = {
      positionId: 'X102',
      ruleBookVersion: '2026.1',
      requiredCriteria: { rank: ['FF'], credentials: [], custom: ['driver_engineer'] },
      pointsPreference: { max: 0, items: [] },
      tieBreakChain: ['rsc_seniority', 'rank_seniority'],
    };
    const ff: Member = {
      employeeId: '44444',
      firstName: 'A',
      lastName: 'B',
      rank: 'FF',
      rscSeniority: 1,
      rankSeniority: 1,
      isProbationary: false,
      credentials: [],
    };
    expect(evaluateEligibility(ff, deRule).eligible).toBe(false);
    expect(
      evaluateEligibility({ ...ff, credentials: [{ name: 'Driver Engineer Qualified' }] }, deRule)
        .eligible,
    ).toBe(true);
  });
});
