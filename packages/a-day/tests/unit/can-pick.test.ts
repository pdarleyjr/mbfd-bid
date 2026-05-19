import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { canPick } from '../../src/can-pick.js';
import { DEFAULT_GROUP_CAPACITY } from '../../src/groups.js';
import type { ADayPick, ADayState } from '../../src/index.js';

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

const lt = (id: number): Member => ({
  employeeId: String(id),
  firstName: 'L',
  lastName: String(id),
  rank: 'LT',
  rscSeniority: id,
  rankSeniority: id,
  isProbationary: false,
  credentials: [],
});

const baseCaps = {
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
} as const;

function buildState(
  opts: Partial<{
    picks: ADayPick[];
    members: Member[];
    bidOrder: number[];
    cursor: number;
    phase1: Array<[number, { positionId: string; shift: 'A' | 'B' | 'C' | 'D' }]>;
    weekdayCaps: Record<string, { max: number | undefined }>;
  }> = {},
): ADayState {
  return {
    groupCaps: baseCaps,
    weekdayCaps: (opts.weekdayCaps ?? {}) as never,
    picksByMember: new Map((opts.picks ?? []).map((p) => [p.memberId, p])),
    bidOrder: opts.bidOrder ?? [],
    cursor: opts.cursor ?? 0,
    phase1ByMember: new Map(opts.phase1 ?? []),
    membersById: new Map((opts.members ?? []).map((m) => [Number(m.employeeId), m])),
  };
}

describe('canPick — gate cases', () => {
  it('UNKNOWN_MEMBER when membersById lacks the candidate', () => {
    const s = buildState({});
    const r = canPick(s, 999, 'G1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('UNKNOWN_MEMBER');
  });

  it('NO_PHASE_1_PICK when member has no Phase 1 record', () => {
    const s = buildState({ members: [ff(1)] });
    const r = canPick(s, 1, 'G1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('NO_PHASE_1_PICK');
  });

  it('ALREADY_PICKED when member already has a Phase 2 pick', () => {
    const s = buildState({
      members: [ff(1)],
      phase1: [[1, { positionId: 'A101', shift: 'A' }]],
      picks: [
        { memberId: 1, shift: 'A', aDay: 'G1', pickedAtMs: 1, forced: false, adminActorId: null },
      ],
    });
    const r = canPick(s, 1, 'G2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('ALREADY_PICKED');
  });

  it('INVALID_A_DAY_FOR_SHIFT — A-shift member picks weekday', () => {
    const s = buildState({
      members: [ff(1)],
      phase1: [[1, { positionId: 'A101', shift: 'A' }]],
    });
    const r = canPick(s, 1, 'FRI');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('INVALID_A_DAY_FOR_SHIFT');
  });

  it('INVALID_A_DAY_FOR_SHIFT — D-shift member picks group', () => {
    const s = buildState({
      members: [ff(1)],
      phase1: [[1, { positionId: 'D101', shift: 'D' }]],
    });
    const r = canPick(s, 1, 'G1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('INVALID_A_DAY_FOR_SHIFT');
  });

  it('GROUP_FULL — A1 already at 19 members', () => {
    const fullPicks: ADayPick[] = Array.from({ length: 19 }, (_, i) => ({
      memberId: i + 100,
      shift: 'A' as const,
      aDay: 'G1' as const,
      pickedAtMs: i,
      forced: false,
      adminActorId: null,
    }));
    const members = [...fullPicks.map((p) => ff(p.memberId)), ff(1)];
    const s = buildState({
      members,
      phase1: [
        [1, { positionId: 'A101', shift: 'A' }],
        ...fullPicks.map((p) => [p.memberId, { positionId: 'A101', shift: 'A' as const }] as const),
      ],
      picks: fullPicks,
    });
    const r = canPick(s, 1, 'G1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('GROUP_FULL');
  });

  it('WEEKDAY_FULL — FRI cap set to 2 and already 2 picks', () => {
    const picks: ADayPick[] = [
      { memberId: 10, shift: 'D', aDay: 'FRI', pickedAtMs: 1, forced: false, adminActorId: null },
      { memberId: 11, shift: 'D', aDay: 'FRI', pickedAtMs: 2, forced: false, adminActorId: null },
    ];
    const s = buildState({
      members: [ff(10), ff(11), ff(1)],
      phase1: [
        [1, { positionId: 'D101', shift: 'D' }],
        [10, { positionId: 'D101', shift: 'D' }],
        [11, { positionId: 'D101', shift: 'D' }],
      ],
      picks,
      weekdayCaps: { FRI: { max: 2 } },
    });
    const r = canPick(s, 1, 'FRI');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('WEEKDAY_FULL');
  });

  it('OFFICER_INVARIANT_VIOLATED — 6th officer in a group of 5', () => {
    const fivePicks: ADayPick[] = [10, 11, 12, 13, 14].map((id) => ({
      memberId: id,
      shift: 'A' as const,
      aDay: 'G1' as const,
      pickedAtMs: id,
      forced: false,
      adminActorId: null,
    }));
    const s = buildState({
      members: [...fivePicks.map((p) => lt(p.memberId)), lt(99)],
      phase1: [
        [99, { positionId: 'A101', shift: 'A' }],
        ...fivePicks.map((p) => [p.memberId, { positionId: 'A101', shift: 'A' as const }] as const),
      ],
      picks: fivePicks,
    });
    const r = canPick(s, 99, 'G1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('OFFICER_INVARIANT_VIOLATED');
  });
});

describe('canPick — happy paths', () => {
  it('FF on A-shift picks an empty group — ok with projectedMeter', () => {
    // Seed enough remaining officers so the look-ahead can satisfy 5/group.
    const remainingOfficerIds = Array.from({ length: 20 }, (_, i) => 200 + i);
    const s = buildState({
      members: [ff(1), ...remainingOfficerIds.map((id) => lt(id))],
      phase1: [
        [1, { positionId: 'A105', shift: 'A' }],
        ...remainingOfficerIds.map(
          (id) => [id, { positionId: 'A105', shift: 'A' as const }] as const,
        ),
      ],
      bidOrder: [1, ...remainingOfficerIds],
      cursor: 0,
    });
    const r = canPick(s, 1, 'G2');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projectedMeter.total).toBe(1);
      expect(r.projectedMeter.officers).toBe(0);
      expect(r.officerSnapshot).toBeDefined();
    }
  });

  it('D-shift FF picks FRI (no cap) — ok, officerSnapshot omitted', () => {
    const s = buildState({
      members: [ff(1)],
      phase1: [[1, { positionId: 'D101', shift: 'D' }]],
    });
    const r = canPick(s, 1, 'FRI');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.officerSnapshot).toBeUndefined();
      expect(r.projectedMeter.max).toBeUndefined();
    }
  });
});
