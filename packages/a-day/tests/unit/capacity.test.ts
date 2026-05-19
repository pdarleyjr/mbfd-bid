import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { computeAllMeters, computeCapacityMeter, isGroupFull } from '../../src/capacity.js';
import { DEFAULT_GROUP_CAPACITY } from '../../src/groups.js';
import type { ADayPick, ADayState } from '../../src/index.js';

const officer = (id: number, rank: 'LT' | 'CPT' | 'DC' = 'LT'): Member => ({
  employeeId: String(id),
  firstName: 'O',
  lastName: String(id),
  rank,
  rscSeniority: id,
  rankSeniority: id,
  isProbationary: false,
  credentials: [],
});

const ff = (id: number): Member => ({
  employeeId: String(id),
  firstName: 'F',
  lastName: String(id),
  rank: 'FF',
  rscSeniority: id,
  rankSeniority: id,
  isProbationary: false,
  credentials: [],
});

function buildState(picks: ADayPick[], members: Member[]): ADayState {
  return {
    groupCaps: {
      A: {
        G1: { ...DEFAULT_GROUP_CAPACITY },
        G2: { ...DEFAULT_GROUP_CAPACITY },
        G3: { ...DEFAULT_GROUP_CAPACITY },
        G4: { ...DEFAULT_GROUP_CAPACITY },
      },
      B: {
        G1: { ...DEFAULT_GROUP_CAPACITY },
        G2: { ...DEFAULT_GROUP_CAPACITY },
        G3: { ...DEFAULT_GROUP_CAPACITY },
        G4: { ...DEFAULT_GROUP_CAPACITY },
      },
      C: {
        G1: { ...DEFAULT_GROUP_CAPACITY },
        G2: { ...DEFAULT_GROUP_CAPACITY },
        G3: { ...DEFAULT_GROUP_CAPACITY },
        G4: { ...DEFAULT_GROUP_CAPACITY },
      },
    },
    weekdayCaps: {},
    picksByMember: new Map(picks.map((p) => [p.memberId, p])),
    bidOrder: [],
    cursor: 0,
    phase1ByMember: new Map(),
    membersById: new Map(members.map((m) => [Number(m.employeeId), m])),
  };
}

describe('computeCapacityMeter — A/B/C groups', () => {
  it('empty group returns total=0, officers=0, isFull=false', () => {
    const s = buildState([], []);
    const m = computeCapacityMeter(s, 'A', 'G1');
    expect(m.total).toBe(0);
    expect(m.officers).toBe(0);
    expect(m.max).toBe(19);
    expect(m.officersRequired).toBe(5);
    expect(m.isFull).toBe(false);
  });

  it('counts only picks matching the shift+group', () => {
    const picks: ADayPick[] = [
      { memberId: 1, shift: 'A', aDay: 'G1', pickedAtMs: 1, forced: false, adminActorId: null },
      { memberId: 2, shift: 'A', aDay: 'G2', pickedAtMs: 2, forced: false, adminActorId: null },
      { memberId: 3, shift: 'B', aDay: 'G1', pickedAtMs: 3, forced: false, adminActorId: null },
    ];
    const s = buildState(picks, [officer(1), officer(2), officer(3)]);
    expect(computeCapacityMeter(s, 'A', 'G1').total).toBe(1);
    expect(computeCapacityMeter(s, 'A', 'G2').total).toBe(1);
    expect(computeCapacityMeter(s, 'B', 'G1').total).toBe(1);
    expect(computeCapacityMeter(s, 'C', 'G1').total).toBe(0);
  });

  it('officers count incremented only for DC/CPT/LT picks', () => {
    const picks: ADayPick[] = [
      { memberId: 1, shift: 'A', aDay: 'G1', pickedAtMs: 1, forced: false, adminActorId: null },
      { memberId: 2, shift: 'A', aDay: 'G1', pickedAtMs: 2, forced: false, adminActorId: null },
      { memberId: 3, shift: 'A', aDay: 'G1', pickedAtMs: 3, forced: false, adminActorId: null },
    ];
    const s = buildState(picks, [officer(1, 'CPT'), ff(2), officer(3, 'LT')]);
    const m = computeCapacityMeter(s, 'A', 'G1');
    expect(m.total).toBe(3);
    expect(m.officers).toBe(2);
  });

  it('isFull true when total === max', () => {
    const picks: ADayPick[] = Array.from({ length: 19 }, (_, i) => ({
      memberId: i + 1,
      shift: 'A' as const,
      aDay: 'G1' as const,
      pickedAtMs: i,
      forced: false,
      adminActorId: null,
    }));
    const members = picks.map((p) => ff(p.memberId));
    const s = buildState(picks, members);
    expect(computeCapacityMeter(s, 'A', 'G1').isFull).toBe(true);
  });

  it('unknown member is counted toward total but NOT toward officers', () => {
    const picks: ADayPick[] = [
      { memberId: 99, shift: 'A', aDay: 'G1', pickedAtMs: 1, forced: false, adminActorId: null },
    ];
    const s = buildState(picks, []);
    const m = computeCapacityMeter(s, 'A', 'G1');
    expect(m.total).toBe(1);
    expect(m.officers).toBe(0);
  });
});

describe('computeCapacityMeter — D shift weekdays', () => {
  it('no cap by default — max is undefined and isFull is always false', () => {
    const picks: ADayPick[] = [
      { memberId: 1, shift: 'D', aDay: 'FRI', pickedAtMs: 1, forced: false, adminActorId: null },
      { memberId: 2, shift: 'D', aDay: 'FRI', pickedAtMs: 2, forced: false, adminActorId: null },
    ];
    const s = buildState(picks, [officer(1, 'CPT'), officer(2, 'LT')]);
    const m = computeCapacityMeter(s, 'D', 'FRI');
    expect(m.total).toBe(2);
    expect(m.max).toBeUndefined();
    expect(m.officersRequired).toBeUndefined();
    expect(m.isFull).toBe(false);
  });

  it('respects configured weekday max when set', () => {
    const s = buildState(
      [
        { memberId: 1, shift: 'D', aDay: 'FRI', pickedAtMs: 1, forced: false, adminActorId: null },
        { memberId: 2, shift: 'D', aDay: 'FRI', pickedAtMs: 2, forced: false, adminActorId: null },
      ],
      [officer(1), officer(2)],
    );
    const sWithCaps: ADayState = { ...s, weekdayCaps: { FRI: { max: 2 } } };
    const m = computeCapacityMeter(sWithCaps, 'D', 'FRI');
    expect(m.total).toBe(2);
    expect(m.max).toBe(2);
    expect(m.isFull).toBe(true);
  });
});

describe('isGroupFull', () => {
  it('false when total < max', () => {
    const s = buildState([], []);
    expect(isGroupFull(s, 'A', 'G1')).toBe(false);
  });

  it('true when total === max', () => {
    const picks: ADayPick[] = Array.from({ length: 19 }, (_, i) => ({
      memberId: i + 1,
      shift: 'A' as const,
      aDay: 'G1' as const,
      pickedAtMs: i,
      forced: false,
      adminActorId: null,
    }));
    const s = buildState(
      picks,
      picks.map((p) => ff(p.memberId)),
    );
    expect(isGroupFull(s, 'A', 'G1')).toBe(true);
  });
});

describe('computeAllMeters', () => {
  it('returns 12 group meters + N weekday meters', () => {
    const s = buildState([], []);
    const meters = computeAllMeters(s);
    expect(meters.groups.length).toBe(12);
    expect(meters.weekdays.length).toBe(7);
  });

  it('each group meter has shift, group, meter fields', () => {
    const s = buildState([], []);
    const meters = computeAllMeters(s);
    for (const m of meters.groups) {
      expect(m.shift).toMatch(/^[ABC]$/);
      expect(m.group).toMatch(/^G[1-4]$/);
      expect(typeof m.meter.total).toBe('number');
    }
  });
});
