import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenAnnualOperationsPolicy,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { evaluateFrozenSimultaneousADays } from '../../src/lib/frozen-a-day.js';

type Entry = {
  id: string;
  memberId: number;
  shift: 'A' | 'B' | 'C' | 'D';
  rank: 'FF' | 'LT' | 'CPT' | 'DC';
  aDay?: 'G1' | 'G2' | 'G3' | 'G4' | 'MON' | undefined;
};
type Execution = NonNullable<FrozenAnnualOperationsPolicy['aDay']['execution']>;
const entry = (id: number, overrides: Partial<Entry> = {}): Entry => ({
  id: `p${id}`,
  memberId: id,
  shift: 'A',
  rank: 'FF',
  aDay: 'G1',
  ...overrides,
});
const scope = (
  id: string,
  maximum: number,
  positionIds: string[] = [],
  memberIds: number[] = [],
): Execution['constraints'][number] => ({
  id,
  label: id,
  sourceRef: `synthetic:${id}`,
  maximum,
  positionIds,
  memberIds,
  ranks: [],
  shifts: ['A', 'B', 'C'],
});
function fixture(
  entries: Entry[],
  options: {
    min?: number;
    max?: number;
    officers?: number | null;
    constraints?: Execution['constraints'];
    legacy?: boolean;
  } = {},
) {
  const policy = {
    v: 1,
    policyRevision: 'synthetic-simultaneous-aday',
    stages: [
      {
        id: 'synthetic-stage',
        label: 'Synthetic stage',
        order: 0,
        kind: 'FIREFIGHTER',
        memberIds: entries.map((e) => e.memberId),
        opportunityPositionIds: entries.map((e) => e.id),
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [99],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['synthetic-stage'],
      requiredTopologyPositionIds: entries.map((e) => e.id),
      specialties: [],
      contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: options.min ?? 0,
        max: options.max ?? 10,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        ...(options.legacy
          ? {}
          : {
              execution: {
                timing: 'SIMULTANEOUS',
                officersPerGroup: options.officers ?? null,
                sourceRef: 'synthetic:aday-policy',
                constraints: options.constraints ?? [],
              },
            }),
      },
    },
  };
  const parsed = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: 'synthetic.1',
    positionTemplateVersion: 'synthetic.1',
    ruleBookRevision: 1,
    configurationRevision: 1,
    capturedAtMs: 1,
    credentialEvaluationOn: '2027-01-01',
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      livePolicy: policy,
    },
    members: entries.map((e) => ({
      memberId: e.memberId,
      pool: e.rank === 'FF' ? 'FF' : 'OFC',
      rscSeniority: e.memberId,
      rankSeniority: e.memberId,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      rank: e.rank,
      isProbationary: false,
      credentialNames: [],
    })),
    ruleBookMaterial: {
      v: 1,
      positions: entries.map((e) => ({
        id: e.id,
        templateVersion: 'synthetic.1',
        shift: e.shift,
        station: 'Synthetic',
        unit: 'Synthetic',
        rankRequired: e.rank,
        positionName: e.id,
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: false,
      })),
      rules: entries.map((e) => ({
        ruleBookVersion: 'synthetic.1',
        templateVersion: 'synthetic.1',
        positionId: e.id,
        requiredCriteriaJson: '[]',
        pointsPreferenceJson: '[]',
        tieBreakChainJson: '[]',
      })),
    },
  });
  if (parsed.v !== 3) throw new Error('Expected V3');
  const state: BidSessionState = {
    ...emptyBidSessionState('synthetic'),
    fills: Object.fromEntries(
      entries.map((e, index) => [
        e.id,
        {
          memberId: e.memberId,
          ordinal: index + 1,
          bidId: `b${index}`,
          ...(e.aDay ? { aDay: e.aDay } : {}),
        },
      ]),
    ),
  };
  return { snapshot: parsed, state };
}
function evaluate(
  f: ReturnType<typeof fixture>,
  overrides: Partial<Parameters<typeof evaluateFrozenSimultaneousADays>[2]> = {},
) {
  return evaluateFrozenSimultaneousADays(f.snapshot, f.state, {
    nowMs: 1000,
    actorId: 99,
    forced: false,
    finalize: false,
    ...overrides,
  });
}

describe('frozen simultaneous A-Day allocation', () => {
  it.each([false, true])(
    'requires an A-Day and enforces group capacity even forced=%s',
    (forced) => {
      expect(evaluate(fixture([entry(1, { aDay: undefined })]), { forced })).toEqual({
        ok: false,
        code: 'A_DAY_REQUIRED_WITH_SELECTION',
      });
      expect(evaluate(fixture([entry(1), entry(2)], { max: 1 }), { forced })).toEqual({
        ok: false,
        code: 'GROUP_FULL',
      });
    },
  );
  it('rebuilds amended group counts from current awards and preserves unchanged pick evidence', () => {
    const f = fixture([entry(1), entry(2, { aDay: 'G2' })], { max: 1 });
    const first = evaluate(f);
    if (!first.ok || !first.aDay) throw new Error('Expected allocation');
    f.state.aDay = first.aDay;
    const pickBefore = first.aDay.picks.find((p) => p.memberId === 2);
    f.state.fills.p1 = { memberId: 1, ordinal: 1, bidId: 'amended', aDay: 'G3' };
    const amended = evaluate(f, { nowMs: 2000 });
    if (!amended.ok || !amended.aDay) throw new Error('Expected amended allocation');
    expect(amended.aDay.picks.find((p) => p.memberId === 1)).toMatchObject({
      aDay: 'G3',
      pickedAtMs: 2000,
    });
    expect(amended.aDay.picks.find((p) => p.memberId === 2)).toEqual(pickBefore);
    f.state.fills.p1 = { ...f.state.fills.p1, aDay: 'G2' };
    expect(evaluate(f)).toEqual({ ok: false, code: 'GROUP_FULL' });
  });
  it('enforces separate Marine core max1 and combined core plus float max2', () => {
    const constraints = [
      scope('marine-core', 1, ['p1', 'p2']),
      scope('marine-total', 2, ['p1', 'p2', 'p3']),
    ];
    expect(evaluate(fixture([entry(1), entry(2)], { constraints }))).toEqual({
      ok: false,
      code: 'SCOPED_A_DAY_MAXIMUM',
    });
    expect(evaluate(fixture([entry(1), entry(3)], { constraints }))).toMatchObject({ ok: true });
    const total = [scope('marine-core', 1, ['p1']), scope('marine-total', 2, ['p1', 'p2', 'p3'])];
    expect(evaluate(fixture([entry(1), entry(2), entry(3)], { constraints: total }))).toEqual({
      ok: false,
      code: 'SCOPED_A_DAY_MAXIMUM',
    });
  });
  it('applies SWAT member scope and explicit DE position scope without treating every firefighter as either', () => {
    expect(
      evaluate(fixture([entry(1), entry(2)], { constraints: [scope('swat', 1, [], [1, 2])] })),
    ).toEqual({ ok: false, code: 'SCOPED_A_DAY_MAXIMUM' });
    expect(
      evaluate(fixture([entry(1), entry(3)], { constraints: [scope('swat', 1, [], [1, 2])] })),
    ).toMatchObject({ ok: true });
    expect(
      evaluate(fixture([entry(1), entry(2)], { constraints: [scope('de', 1, ['p1', 'p2'])] })),
    ).toEqual({ ok: false, code: 'SCOPED_A_DAY_MAXIMUM' });
  });
  it('enforces the combined Captain/DC cap while allowing Lieutenants and independent groups', () => {
    expect(
      evaluate(fixture([entry(1, { rank: 'CPT' }), entry(2, { rank: 'DC' })]), { forced: true }),
    ).toEqual({ ok: false, code: 'SCOPED_A_DAY_MAXIMUM' });
    expect(evaluate(fixture([entry(1, { rank: 'CPT' }), entry(2, { rank: 'LT' })]))).toMatchObject({
      ok: true,
    });
    expect(
      evaluate(fixture([entry(1, { rank: 'CPT' }), entry(2, { rank: 'DC', aDay: 'G2' })])),
    ).toMatchObject({ ok: true });
  });
  it('enforces final minimums in every combat shift/group while allowing incomplete allocations before completion', () => {
    const incomplete = fixture([entry(1)], { min: 1 });
    expect(evaluate(incomplete)).toMatchObject({ ok: true });
    expect(evaluate(incomplete, { finalize: true })).toEqual({
      ok: false,
      code: 'A_DAY_MINIMUM_NOT_MET',
    });
    const entries: Entry[] = [];
    for (const shift of ['A', 'B', 'C'] as const)
      for (const aDay of ['G1', 'G2', 'G3', 'G4'] as const)
        entries.push(entry(entries.length + 1, { shift, aDay }));
    expect(evaluate(fixture(entries, { min: 1 }), { finalize: true })).toMatchObject({ ok: true });
    expect(evaluate(fixture(entries, { min: 1, officers: 1 }), { finalize: true })).toEqual({
      ok: false,
      code: 'A_DAY_OFFICER_TOTAL_NOT_MET',
    });
    expect(
      evaluate(
        fixture(
          entries.map((e) => ({ ...e, rank: 'LT' })),
          { min: 1, officers: 1 },
        ),
        { finalize: true },
      ),
    ).toMatchObject({ ok: true });
  });
  it('leaves historical snapshots unchanged and rejects introducing simultaneous awards without source policy', () => {
    const legacy = fixture([entry(1, { aDay: undefined })], { legacy: true });
    const before = structuredClone(legacy.state);
    expect(evaluate(legacy, { finalize: true })).toEqual({ ok: true, aDay: legacy.state.aDay });
    expect(legacy.state).toEqual(before);
    legacy.state.fills.p1 = { memberId: 1, ordinal: 1, bidId: 'b1', aDay: 'G1' };
    expect(evaluate(legacy)).toEqual({ ok: false, code: 'A_DAY_EXECUTION_POLICY_MISSING' });
  });
});
