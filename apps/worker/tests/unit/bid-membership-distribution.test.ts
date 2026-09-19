import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenAnnualOperationsPolicy,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { evaluateMembershipDistributions } from '../../src/lib/bid-membership-distribution.js';

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
      membershipDistributions: [
        {
          id: 'synthetic-team',
          label: 'Synthetic fixed team',
          sourceRef: 'synthetic:reviewed-team',
          sourceDecisionId: 'synthetic-team-source',
          membershipSource: 'REVIEWED_EXISTING_MEMBERS',
          memberIds: [1, 2, 3, 4, 5, 6],
          shifts: ['A', 'B', 'C'],
          minimumPerShift: 2,
          maximumPerShift: 2,
          maximumPerADay: 1,
        },
      ],
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

function team() {
  return fixture([
    entry(1),
    entry(2, { aDay: 'G2' }),
    entry(3, { shift: 'B' }),
    entry(4, { shift: 'B', aDay: 'G2' }),
    entry(5, { shift: 'C' }),
    entry(6, { shift: 'C', aDay: 'G2' }),
  ]);
}
describe('reviewed fixed membership distribution', () => {
  it('supports a wider qualified pool with explicit elected overlays and no extra station award', () => {
    const f = team();
    if (f.snapshot.settings.v !== 3) throw new Error('V3 required');
    const distribution =
      f.snapshot.settings.livePolicy.annualOperations?.membershipDistributions?.[0];
    if (!distribution) throw new Error('Distribution required');
    distribution.membershipSource = 'REVIEWED_QUALIFIED_POOL';
    distribution.requiredSpecialtyCode = 'SYNTHETIC_SWAT';
    for (const member of f.snapshot.members)
      member.specialtyQualifications = [
        {
          specialtyCode: 'SYNTHETIC_SWAT',
          status: 'active',
          effectiveOn: '2026-01-01',
          expiresOn: null,
        },
      ];
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_SHIFT_MINIMUM_NOT_MET',
    });
    for (const fill of Object.values(f.state.fills)) fill.membershipIds = [distribution.id];
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({ ok: true });
    expect(Object.keys(f.state.fills)).toHaveLength(6);
    const member = f.snapshot.members[0];
    if (!member) throw new Error('Member required');
    member.specialtyQualifications = [];
    expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_QUALIFICATION_EVIDENCE_REQUIRED',
    });
  });
  it('rejects unconfigured overlay IDs even when no distribution exists', () => {
    const f = team();
    const fill = f.state.fills.p1;
    if (!fill) throw new Error('Fill required');
    fill.membershipIds = ['unconfigured'];
    expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_POOL_SELECTION_INVALID',
    });
  });
  it('allows exactly two ordinary awards per shift with one team member per group without mutation', () => {
    const f = team();
    const before = structuredClone(f);
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({ ok: true });
    expect(f).toEqual(before);
    expect(Object.keys(f.state.fills)).toHaveLength(6);
  });
  it('enforces shift maxima and group maxima before completion', () => {
    const shift = team();
    const seat = shift.snapshot.ruleBookMaterial.positions.find((p) => p.id === 'p3');
    if (!seat) throw new Error('Synthetic seat required');
    seat.shift = 'A';
    shift.state.fills.p3 = { memberId: 3, ordinal: 3, bidId: 'b3', aDay: 'G3' };
    expect(evaluateMembershipDistributions(shift.snapshot, shift.state, false)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_SHIFT_MAXIMUM_REACHED',
    });
    const group = team();
    group.state.fills.p2 = { memberId: 2, ordinal: 2, bidId: 'b2', aDay: 'G1' };
    expect(evaluateMembershipDistributions(group.snapshot, group.state, false)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_A_DAY_MAXIMUM_REACHED',
    });
  });
  it('does not impose completion minima during allocation but blocks incomplete membership at completion', () => {
    const f = team();
    f.state.fills = Object.fromEntries(Object.entries(f.state.fills).filter(([id]) => id !== 'p6'));
    expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({ ok: true });
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_ASSIGNMENTS_INCOMPLETE',
    });
  });
  it('checks each shift minimum at completion independently of complete membership assignments', () => {
    const f = team();
    if (f.snapshot.settings.v !== 3) throw new Error('Expected V3 settings');
    const distribution =
      f.snapshot.settings.livePolicy.annualOperations?.membershipDistributions?.[0];
    if (!distribution) throw new Error('Distribution required');
    distribution.minimumPerShift = 1;
    distribution.maximumPerShift = 3;
    for (const seat of f.snapshot.ruleBookMaterial.positions) {
      if (seat.id === 'p5') seat.shift = 'A';
      if (seat.id === 'p6') seat.shift = 'B';
    }
    f.state.fills.p5 = { memberId: 5, ordinal: 5, bidId: 'b5', aDay: 'G3' };
    f.state.fills.p6 = { memberId: 6, ordinal: 6, bidId: 'b6', aDay: 'G3' };
    expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({ ok: true });
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_SHIFT_MINIMUM_NOT_MET',
    });
  });
  it.each(['missing', 'excluded'] as const)(
    'fails closed on %s frozen membership evidence',
    (mode) => {
      const f = team();
      if (mode === 'missing')
        f.snapshot.members = f.snapshot.members.filter((m) => m.memberId !== 6);
      else {
        const member = f.snapshot.members.find((m) => m.memberId === 6);
        if (!member) throw new Error('Member required');
        member.pool = 'EXCLUDED';
      }
      expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({
        ok: false,
        code: 'MEMBERSHIP_PARTICIPANT_EVIDENCE_REQUIRED',
      });
    },
  );
  it('rejects duplicate ordinary awards and noncombat shift assignments', () => {
    const f = team();
    f.state.fills.p2 = { memberId: 1, ordinal: 2, bidId: 'duplicate', aDay: 'G2' };
    expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_MULTIPLE_ASSIGNMENTS',
    });
    const wrong = team();
    const seat = wrong.snapshot.ruleBookMaterial.positions[0];
    if (!seat) throw new Error('Seat required');
    seat.shift = 'D';
    expect(evaluateMembershipDistributions(wrong.snapshot, wrong.state, false)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_SHIFT_NOT_PERMITTED',
    });
  });
  it('requires an A-Day at completion and preserves historical absence of distribution policy', () => {
    const f = team();
    f.state.fills.p1 = { memberId: 1, ordinal: 1, bidId: 'without-group' };
    expect(evaluateMembershipDistributions(f.snapshot, f.state, false)).toEqual({ ok: true });
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({
      ok: false,
      code: 'MEMBERSHIP_A_DAY_REQUIRED',
    });
    if (f.snapshot.settings.v !== 3 || !f.snapshot.settings.livePolicy.annualOperations)
      throw new Error('Annual policy required');
    f.snapshot.settings.livePolicy.annualOperations.membershipDistributions = undefined;
    expect(evaluateMembershipDistributions(f.snapshot, f.state, true)).toEqual({ ok: true });
  });
});
