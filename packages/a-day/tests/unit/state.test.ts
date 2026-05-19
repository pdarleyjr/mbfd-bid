import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_CAPACITY } from '../../src/groups.js';
import { applyPick, initADayState } from '../../src/state.js';

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

const fullGroupCaps = {
  A: {
    G1: DEFAULT_GROUP_CAPACITY,
    G2: DEFAULT_GROUP_CAPACITY,
    G3: DEFAULT_GROUP_CAPACITY,
    G4: DEFAULT_GROUP_CAPACITY,
  },
  B: {
    G1: DEFAULT_GROUP_CAPACITY,
    G2: DEFAULT_GROUP_CAPACITY,
    G3: DEFAULT_GROUP_CAPACITY,
    G4: DEFAULT_GROUP_CAPACITY,
  },
  C: {
    G1: DEFAULT_GROUP_CAPACITY,
    G2: DEFAULT_GROUP_CAPACITY,
    G3: DEFAULT_GROUP_CAPACITY,
    G4: DEFAULT_GROUP_CAPACITY,
  },
} as const;

describe('initADayState', () => {
  it('builds bidOrder from phase 1 picks (in given order)', () => {
    const state = initADayState({
      phase1Picks: [
        { memberId: 1, positionId: 'A101', shift: 'A' },
        { memberId: 2, positionId: 'B105', shift: 'B' },
      ],
      members: [ff(1), ff(2)],
      bidOrder: [1, 2],
      groupCaps: fullGroupCaps,
      weekdayCaps: {},
    });
    expect(state.bidOrder).toEqual([1, 2]);
    expect(state.cursor).toBe(0);
    expect(state.picksByMember.size).toBe(0);
    expect(state.phase1ByMember.get(1)?.shift).toBe('A');
  });

  it('does not include members without Phase 1 picks (vacant-or-skipped)', () => {
    const state = initADayState({
      phase1Picks: [{ memberId: 1, positionId: 'A101', shift: 'A' }],
      members: [ff(1), ff(2)],
      bidOrder: [1, 2],
      groupCaps: fullGroupCaps,
      weekdayCaps: {},
    });
    expect(state.phase1ByMember.has(1)).toBe(true);
    expect(state.phase1ByMember.has(2)).toBe(false);
  });

  it('seeds pre-seeded picks (e.g., Union President) without advancing the cursor', () => {
    const state = initADayState({
      phase1Picks: [
        { memberId: 1, positionId: 'A101', shift: 'A' },
        { memberId: 99, positionId: 'A701', shift: 'A' },
      ],
      members: [ff(1), ff(99)],
      bidOrder: [1],
      preSeededPicks: [
        { memberId: 99, shift: 'A', aDay: 'G4', pickedAtMs: 0, forced: true, adminActorId: 1 },
      ],
      groupCaps: fullGroupCaps,
      weekdayCaps: {},
    });
    expect(state.picksByMember.size).toBe(1);
    expect(state.picksByMember.get(99)?.forced).toBe(true);
    expect(state.bidOrder).toEqual([1]);
    expect(state.cursor).toBe(0);
  });
});

describe('applyPick', () => {
  it('returns new state with pick recorded and cursor advanced', () => {
    const initial = initADayState({
      phase1Picks: [
        { memberId: 1, positionId: 'A101', shift: 'A' },
        { memberId: 2, positionId: 'A105', shift: 'A' },
      ],
      members: [ff(1), ff(2)],
      bidOrder: [1, 2],
      groupCaps: fullGroupCaps,
      weekdayCaps: {},
    });
    const next = applyPick(initial, {
      memberId: 1,
      shift: 'A',
      aDay: 'G1',
      pickedAtMs: 100,
      forced: false,
      adminActorId: null,
    });
    expect(next.cursor).toBe(1);
    expect(next.picksByMember.get(1)?.aDay).toBe('G1');
    // Immutability: original is unchanged
    expect(initial.cursor).toBe(0);
    expect(initial.picksByMember.size).toBe(0);
  });

  it('skips cursor past pre-seeded members already picked', () => {
    const initial = initADayState({
      phase1Picks: [
        { memberId: 1, positionId: 'A101', shift: 'A' },
        { memberId: 99, positionId: 'A701', shift: 'A' },
        { memberId: 2, positionId: 'A105', shift: 'A' },
      ],
      members: [ff(1), ff(99), ff(2)],
      bidOrder: [1, 99, 2],
      preSeededPicks: [
        { memberId: 99, shift: 'A', aDay: 'G4', pickedAtMs: 0, forced: true, adminActorId: 1 },
      ],
      groupCaps: fullGroupCaps,
      weekdayCaps: {},
    });
    const next = applyPick(initial, {
      memberId: 1,
      shift: 'A',
      aDay: 'G1',
      pickedAtMs: 100,
      forced: false,
      adminActorId: null,
    });
    // After member 1 picks, cursor should jump from 0 to 2 (skipping member 99).
    expect(next.cursor).toBe(2);
  });
});
