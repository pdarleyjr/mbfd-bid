import { describe, expect, it } from 'vitest';
import {
  type ADayScopedConstraint,
  type GroupCapacityConfig,
  type Member,
  applyPick,
  canPick,
  initADayState,
} from '../../src/index.js';

const member = (id: number, rank: Member['rank'] = 'FF'): Member => ({
  employeeId: String(id),
  firstName: 'Synthetic',
  lastName: String(id),
  rank,
  rscSeniority: id,
  rankSeniority: id,
  isProbationary: false,
  credentials: [],
});
const constraint = (
  id: string,
  maximum: number,
  positionIds: string[],
  memberIds: number[] = [],
  ranks: Member['rank'][] = [],
): ADayScopedConstraint => ({
  id,
  label: id,
  sourceRef: `synthetic:${id}`,
  maximum,
  positionIds,
  memberIds,
  ranks,
  shifts: ['A', 'B', 'C'],
});
function fixture(
  constraints: ADayScopedConstraint[],
  ranks: Member['rank'][] = ['FF', 'FF', 'FF', 'FF'],
  overrides: Partial<GroupCapacityConfig> = {},
  allocationIncomplete = false,
) {
  const cap: GroupCapacityConfig = {
    min: 0,
    max: 10,
    officersRequired: 0,
    officerMode: 'NONE',
    ...overrides,
  };
  const groups = { G1: cap, G2: cap, G3: cap, G4: cap };
  return initADayState({
    members: ranks.map((rank, index) => member(index + 1, rank)),
    phase1Picks: ranks.map((_, index) => ({
      memberId: index + 1,
      positionId: `p${index + 1}`,
      shift: 'A' as const,
    })),
    bidOrder: ranks.map((_, index) => index + 1),
    groupCaps: { A: groups, B: groups, C: groups },
    weekdayCaps: {},
    constraints,
    allocationIncomplete,
  });
}
function pick(state: ReturnType<typeof fixture>, memberId: number) {
  expect(canPick(state, memberId, 'G1')).toMatchObject({ ok: true });
  return applyPick(state, {
    memberId,
    shift: 'A',
    aDay: 'G1',
    pickedAtMs: memberId,
    forced: false,
    adminActorId: null,
  });
}

describe('explicit A-Day scope constraints', () => {
  it('enforces Marine core max1 independently from combined core/float max2', () => {
    const rules = [
      constraint('marine-core', 1, ['p1', 'p2']),
      constraint('marine-combined', 2, ['p1', 'p2', 'p3', 'p4']),
    ];
    const first = pick(fixture(rules), 1);
    expect(canPick(first, 2, 'G1')).toMatchObject({
      ok: false,
      reasonCode: 'SCOPED_A_DAY_MAXIMUM',
      detail: { constraintId: 'marine-core' },
    });
    const combined = pick(first, 3);
    expect(canPick(combined, 4, 'G1')).toMatchObject({
      ok: false,
      reasonCode: 'SCOPED_A_DAY_MAXIMUM',
      detail: { constraintId: 'marine-combined' },
    });
    expect(canPick(combined, 4, 'G2')).toMatchObject({ ok: true });
  });
  it('uses SWAT member identities and DE position identities without inferring labels or qualifications', () => {
    const swat = pick(fixture([constraint('swat', 1, [], [1, 2])]), 1);
    expect(canPick(swat, 2, 'G1')).toMatchObject({ ok: false, reasonCode: 'SCOPED_A_DAY_MAXIMUM' });
    expect(canPick(swat, 3, 'G1')).toMatchObject({ ok: true });
    const de = pick(fixture([constraint('de', 1, ['p1', 'p3'])]), 1);
    expect(canPick(de, 3, 'G1')).toMatchObject({ ok: false, reasonCode: 'SCOPED_A_DAY_MAXIMUM' });
    expect(canPick(de, 2, 'G1')).toMatchObject({ ok: true });
  });
  it('enforces rank scopes and shift scopes independently', () => {
    const rule = constraint('captain-dc', 1, [], [], ['CPT', 'DC']);
    const selected = pick(fixture([rule], ['CPT', 'DC', 'LT', 'FF']), 1);
    expect(canPick(selected, 2, 'G1')).toMatchObject({
      ok: false,
      reasonCode: 'SCOPED_A_DAY_MAXIMUM',
    });
    expect(canPick(selected, 3, 'G1')).toMatchObject({ ok: true });
    expect(canPick(fixture([{ ...rule, shifts: ['B'] }], ['CPT', 'DC']), 1, 'G1')).toMatchObject({
      ok: true,
    });
  });
  it('skips exact-officer lookahead only for incomplete allocations and still rejects direct overflow', () => {
    const exact = { officersRequired: 1, officerMode: 'EXACT' as const };
    expect(canPick(fixture([], ['FF'], exact), 1, 'G1')).toMatchObject({
      ok: false,
      reasonCode: 'OFFICER_INVARIANT_VIOLATED',
    });
    expect(canPick(fixture([], ['FF'], exact, true), 1, 'G1')).toMatchObject({ ok: true });
    const oneOfficer = pick(fixture([], ['LT', 'CPT'], exact, true), 1);
    expect(canPick(oneOfficer, 2, 'G1')).toMatchObject({
      ok: false,
      reasonCode: 'OFFICER_INVARIANT_VIOLATED',
    });
    expect(canPick(fixture([], ['LT'], { officerMode: 'NONE' }), 1, 'G1')).toMatchObject({
      ok: true,
    });
  });
});
