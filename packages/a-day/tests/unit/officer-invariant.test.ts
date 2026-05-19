import type { Member } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_CAPACITY } from '../../src/groups.js';
import type { ADayPick, ADayState } from '../../src/index.js';
import { projectedOfficers, validateOfficerInvariant } from '../../src/officer-invariant.js';

const officer = (id: number): Member => ({
  employeeId: String(id),
  firstName: 'O',
  lastName: String(id),
  rank: 'LT',
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

function buildState(opts: {
  picks: ADayPick[];
  members: Member[];
  bidOrder: number[];
  cursor: number;
  phase1Shifts: ReadonlyMap<number, 'A' | 'B' | 'C' | 'D'>;
}): ADayState {
  return {
    groupCaps: baseCaps,
    weekdayCaps: {},
    picksByMember: new Map(opts.picks.map((p) => [p.memberId, p])),
    bidOrder: opts.bidOrder,
    cursor: opts.cursor,
    phase1ByMember: new Map(
      [...opts.phase1Shifts].map(([id, shift]) => [id, { positionId: `${shift}999`, shift }]),
    ),
    membersById: new Map(opts.members.map((m) => [Number(m.employeeId), m])),
  };
}

describe('projectedOfficers', () => {
  it('returns current count when candidate is a firefighter', () => {
    const s = buildState({
      picks: [
        { memberId: 1, shift: 'A', aDay: 'G1', pickedAtMs: 1, forced: false, adminActorId: null },
      ],
      members: [officer(1), ff(99)],
      bidOrder: [],
      cursor: 0,
      phase1Shifts: new Map(),
    });
    expect(projectedOfficers(s, 'A', 'G1', 99)).toBe(1);
  });

  it('returns current+1 when candidate is an officer', () => {
    const s = buildState({
      picks: [
        { memberId: 1, shift: 'A', aDay: 'G1', pickedAtMs: 1, forced: false, adminActorId: null },
      ],
      members: [officer(1), officer(99)],
      bidOrder: [],
      cursor: 0,
      phase1Shifts: new Map(),
    });
    expect(projectedOfficers(s, 'A', 'G1', 99)).toBe(2);
  });
});

describe('validateOfficerInvariant — basic cases', () => {
  it('officer joining a group with 4 officers → projected=5, feasible=true', () => {
    const fourOfficers: ADayPick[] = [10, 11, 12, 13].map((id) => ({
      memberId: id,
      shift: 'A' as const,
      aDay: 'G1' as const,
      pickedAtMs: id,
      forced: false,
      adminActorId: null,
    }));
    // Need 15 more officers across G2/G3/G4 to reach 5 each, so seed enough remaining.
    const remainingOfficerIds = Array.from({ length: 15 }, (_, i) => 200 + i);
    const members = [
      officer(10),
      officer(11),
      officer(12),
      officer(13),
      officer(99),
      ...remainingOfficerIds.map((id) => officer(id)),
    ];
    const s = buildState({
      picks: fourOfficers,
      members,
      bidOrder: [99, ...remainingOfficerIds],
      cursor: 0,
      phase1Shifts: new Map([[99, 'A'], ...remainingOfficerIds.map((id) => [id, 'A'] as const)]),
    });
    const r = validateOfficerInvariant(s, 'A', 'G1', 99);
    expect(r.feasible).toBe(true);
    expect(r.projectedOfficers).toBe(5);
    expect(r.required).toBe(5);
  });

  it('officer joining a group already at 5 officers → projected=6, feasible=false', () => {
    const fiveOfficers: ADayPick[] = [10, 11, 12, 13, 14].map((id) => ({
      memberId: id,
      shift: 'A' as const,
      aDay: 'G1' as const,
      pickedAtMs: id,
      forced: false,
      adminActorId: null,
    }));
    const s = buildState({
      picks: fiveOfficers,
      members: [officer(10), officer(11), officer(12), officer(13), officer(14), officer(99)],
      bidOrder: [99],
      cursor: 0,
      phase1Shifts: new Map([[99, 'A']]),
    });
    const r = validateOfficerInvariant(s, 'A', 'G1', 99);
    expect(r.feasible).toBe(false);
    expect(r.projectedOfficers).toBe(6);
    expect(r.explanation).toMatch(/exceeds the maximum/i);
  });

  it('firefighter joining any group does not affect officer feasibility', () => {
    // Seed enough remaining officers so the look-ahead can satisfy 5/group across G1..G4.
    const remainingOfficerIds = Array.from({ length: 20 }, (_, i) => 200 + i);
    const s = buildState({
      picks: [],
      members: [ff(99), ...remainingOfficerIds.map((id) => officer(id))],
      bidOrder: [99, ...remainingOfficerIds],
      cursor: 0,
      phase1Shifts: new Map([[99, 'A'], ...remainingOfficerIds.map((id) => [id, 'A'] as const)]),
    });
    const r = validateOfficerInvariant(s, 'A', 'G1', 99);
    expect(r.feasible).toBe(true);
    expect(r.projectedOfficers).toBe(0);
  });
});

describe('validateOfficerInvariant — feasibility across remaining bidders', () => {
  it('returns infeasible when accepting this pick leaves another group unable to reach 5', () => {
    const picksAt4 = (group: 'G1' | 'G2' | 'G3') =>
      [10, 11, 12, 13].map((base) => ({
        memberId: base + (group === 'G1' ? 0 : group === 'G2' ? 100 : 200),
        shift: 'A' as const,
        aDay: group,
        pickedAtMs: 1,
        forced: false,
        adminActorId: null,
      }));
    const at4Picks = [...picksAt4('G1'), ...picksAt4('G2'), ...picksAt4('G3')];
    const remainingOfficerIds = [500, 501, 502, 503];
    const candidateId = 500;
    const s2 = buildState({
      picks: at4Picks,
      members: [
        ...at4Picks.map((p) => officer(p.memberId)),
        ...remainingOfficerIds.map((id) => officer(id)),
      ],
      bidOrder: remainingOfficerIds,
      cursor: 0,
      phase1Shifts: new Map(remainingOfficerIds.map((id) => [id, 'A' as const])),
    });
    const r = validateOfficerInvariant(s2, 'A', 'G1', candidateId);
    // After pick, G1 has 5, but G2/G3 still need 1 each (=2), G4 needs 5 → total 7;
    // remaining officers after this pick = 3 → infeasible.
    expect(r.feasible).toBe(false);
    expect(r.explanation).toMatch(/insufficient officers remaining/i);
  });

  it('feasible when remaining officers exactly equals the shortfall', () => {
    const at5 = (group: 'G1' | 'G2' | 'G3' | 'G4', count: number) =>
      Array.from({ length: count }, (_, i) => ({
        memberId: i + (group === 'G1' ? 100 : group === 'G2' ? 200 : group === 'G3' ? 300 : 400),
        shift: 'A' as const,
        aDay: group,
        pickedAtMs: 1,
        forced: false,
        adminActorId: null,
      }));
    const picks = [...at5('G1', 5), ...at5('G2', 5), ...at5('G3', 5), ...at5('G4', 4)];
    const candidateId = 999;
    const s = buildState({
      picks,
      members: [...picks.map((p) => officer(p.memberId)), officer(candidateId)],
      bidOrder: [candidateId],
      cursor: 0,
      phase1Shifts: new Map([[candidateId, 'A']]),
    });
    const r = validateOfficerInvariant(s, 'A', 'G4', candidateId);
    expect(r.feasible).toBe(true);
  });
});
