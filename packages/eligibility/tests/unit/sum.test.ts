import { describe, expect, it } from 'vitest';
import { computePoints } from '../../src/points/sum.js';
import type { Member, PositionRule } from '../../src/types.js';

const member = (credNames: string[]): Member => ({
  employeeId: '1',
  firstName: 'A',
  lastName: 'B',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: credNames.map((name) => ({ name })),
});

const rule = (items: PositionRule['pointsPreference']['items'], max = 0): PositionRule => ({
  positionId: 'TEST',
  ruleBookVersion: '2026.1',
  requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
  pointsPreference: { max, items },
  tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
});

describe('computePoints', () => {
  it('returns 0 for member with no matching credentials', () => {
    const r = computePoints(
      member([]),
      rule([{ points: 2, credential: 'Car Seat Technician', requiresOpsPair: false }]),
    );
    expect(r.total).toBe(0);
  });

  it('awards points for a matching plain credential (requiresOpsPair false)', () => {
    const r = computePoints(
      member(['Car Seat Technician']),
      rule([{ points: 2, credential: 'Car Seat Technician', requiresOpsPair: false }]),
    );
    expect(r.total).toBe(2);
  });

  it('awards tech points only when ops pair is also held', () => {
    const items = [
      { points: 1, credential: 'Hazardous Materials Operations', requiresOpsPair: false },
      {
        points: 1,
        credential: 'State Certified Hazardous Materials Technician',
        requiresOpsPair: true,
      },
    ];
    const r1 = computePoints(
      member(['Hazardous Materials Operations', 'State Certified Hazardous Materials Technician']),
      rule(items),
    );
    expect(r1.total).toBe(2);
    const r2 = computePoints(
      member(['State Certified Hazardous Materials Technician']),
      rule(items),
    );
    expect(r2.total).toBe(0);
  });

  it('caps total at pointsPreference.max when max > 0', () => {
    const items = [
      { points: 3, credential: 'Cred A', requiresOpsPair: false },
      { points: 3, credential: 'Cred B', requiresOpsPair: false },
    ];
    const r = computePoints(member(['Cred A', 'Cred B']), rule(items, 5));
    expect(r.total).toBe(5);
  });

  it('max=0 means no cap — awards full sum', () => {
    const items = [
      { points: 3, credential: 'Cred A', requiresOpsPair: false },
      { points: 3, credential: 'Cred B', requiresOpsPair: false },
    ];
    const r = computePoints(member(['Cred A', 'Cred B']), rule(items, 0));
    expect(r.total).toBe(6);
  });

  it('itemized breakdown lists awarded amount per credential', () => {
    const items = [{ points: 2, credential: 'Car Seat Technician', requiresOpsPair: false }];
    const r = computePoints(member(['Car Seat Technician']), rule(items));
    expect(r.itemized).toContainEqual(
      expect.objectContaining({ credential: 'Car Seat Technician', awarded: 2 }),
    );
  });

  it('itemized lists 0 for tech held without ops pair', () => {
    const items = [
      {
        points: 1,
        credential: 'State Certified Hazardous Materials Technician',
        requiresOpsPair: true,
      },
    ];
    const r = computePoints(
      member(['State Certified Hazardous Materials Technician']),
      rule(items),
    );
    const item = r.itemized.find(
      (i) => i.credential === 'State Certified Hazardous Materials Technician',
    );
    expect(item?.awarded).toBe(0);
    expect(item?.reason).toMatch(/Operations/);
  });

  it('soTotal and moTotal are 0 (filled by evaluate.ts)', () => {
    const r = computePoints(
      member(['Car Seat Technician']),
      rule([{ points: 2, credential: 'Car Seat Technician', requiresOpsPair: false }]),
    );
    expect(r.soTotal).toBe(0);
    expect(r.moTotal).toBe(0);
  });
});
