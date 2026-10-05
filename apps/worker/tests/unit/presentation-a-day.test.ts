import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import type { Fill, PersistedADayState } from '../../src/durable/bid-session-state.js';
import { projectPresentationADays } from '../../src/lib/presentation-a-day.js';

function fixture() {
  const snapshot = {
    v: 3,
    settings: {
      v: 3,
      livePolicy: {
        annualOperations: {
          aDay: {
            combatGroups: ['G1'],
            max: null,
            captainDcMax: null,
            execution: { officersPerGroup: null, constraints: [] },
          },
          membershipDistributions: [
            {
              id: 'existing',
              label: 'Existing team',
              membershipSource: 'REVIEWED_EXISTING_MEMBERS',
              memberIds: [1],
              shifts: ['A'],
              maximumPerADay: 1,
            },
            {
              id: 'qualified',
              label: 'Optional team',
              membershipSource: 'REVIEWED_QUALIFIED_POOL',
              memberIds: [1, 2],
              shifts: ['A'],
              maximumPerADay: 2,
            },
          ],
        },
      },
    },
    members: [
      { memberId: 1, pool: 'FF', rank: 'FF' },
      { memberId: 2, pool: 'OFC', rank: 'LT' },
      { memberId: 3, pool: 'FF', rank: 'FF', currentBidPositionIds: ['B999'] },
      { memberId: 4, pool: 'OFC', rank: 'CPT' },
    ],
    operatorIdentityProjection: [1, 2, 3, 4].map((memberId) => ({
      memberId,
      firstName: `Member${memberId}`,
      lastName: 'Synthetic',
      rank: memberId === 2 ? 'LT' : memberId === 4 ? 'CPT' : 'FF',
    })),
    ruleBookMaterial: {
      positions: [
        ...[1, 2, 3].map((id) => ({ id: `A00${id}`, shift: 'A', bidParticipation: 'BIDDABLE' })),
        { id: 'D001', shift: 'D', bidParticipation: 'BIDDABLE' },
      ],
    },
  } as unknown as Extract<BidSessionPolicySnapshot, { v: 3 }>;
  const fills: Record<string, Fill> = {
    A001: { memberId: 1, ordinal: 1, bidId: 'award1', aDay: 'G1' },
    A002: {
      memberId: 2,
      ordinal: 2,
      bidId: 'award2',
      aDay: 'G2',
      aDayOverride: {
        aDay: 'G2',
        positionId: 'A002',
        commandId: 'private-command',
        actorMemberId: 99,
        reason: 'PRIVATE-NOTE',
        warningCodes: ['PRIVATE-WARNING'],
      },
    },
    A003: { memberId: 3, ordinal: 3, bidId: 'pending3' },
    D001: { memberId: 4, ordinal: 4, bidId: 'days4' },
  };
  const caps = Object.fromEntries(
    ['G1', 'G2', 'G3', 'G4'].map((group) => [
      group,
      {
        min: 0,
        max: 218,
        officerMode: 'NONE',
        officersRequired: 0,
      },
    ]),
  );
  const aDay = {
    groupCaps: { A: caps, B: caps, C: caps },
    weekdayCaps: {},
    constraints: [
      {
        id: 'scope',
        label: 'Declared scope',
        sourceRef: 'PRIVATE-SOURCE',
        shifts: ['A'],
        maximum: 2,
        memberIds: [3],
        positionIds: ['A001'],
        ranks: ['LT'],
      },
    ],
    picks: [
      { memberId: 4, shift: 'D', aDay: 'MON', pickedAtMs: 1, forced: true, adminActorId: 99 },
    ],
    phase1: [[4, { positionId: 'D001', shift: 'D' }]],
    bidOrder: [3],
    cursor: 0,
  } as unknown as PersistedADayState;
  return { snapshot, fills, aDay, sequence: 17 };
}

describe('member-safe presentation A-Day projection', () => {
  it('uses actual named awards and pending groups with unknown limits; never presents fallback218 or inferred weekdays', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const view = projectPresentationADays(input);
    expect(view.availability).toBe('AVAILABLE');
    expect(view.sequence).toBe(17);
    const first = view.groups.find((group) => group.shift === 'A' && group.value === 'G1');
    expect(first).toMatchObject({
      maximum: null,
      remaining: null,
      used: 1,
      saved_override: false,
      members: [{ member_id: 1, name: 'Member1 Synthetic', position_id: 'A001', forced: false }],
    });
    expect(first?.capacities).toEqual(
      expect.arrayContaining([
        {
          id: 'pool:FF',
          label: 'Firefighters',
          pool: 'FF',
          maximum: null,
          remaining: null,
          used: 1,
        },
        { id: 'pool:OFC', label: 'Officers', pool: 'OFC', maximum: null, remaining: null, used: 0 },
        { id: 'constraint:scope', label: 'Declared scope', maximum: 2, remaining: 1, used: 1 },
        { id: 'membership:existing', label: 'Existing team', maximum: 1, remaining: 0, used: 1 },
        { id: 'membership:qualified', label: 'Optional team', maximum: 2, remaining: 2, used: 0 },
      ]),
    );
    expect(view.pending).toEqual([
      { member_id: 3, name: 'Member3 Synthetic', rank: 'FF', position_id: 'A003', shift: 'A' },
    ]);
    expect(view.groups.filter((group) => group.shift === 'D').map((group) => group.value)).toEqual([
      'MON',
    ]);
    expect(view.groups.find((group) => group.shift === 'D' && group.value === 'MON')).toMatchObject(
      {
        saved_override: false,
        members: [{ member_id: 4, forced: true }],
      },
    );
    expect(JSON.stringify(view)).not.toMatch(
      /218|PRIVATE-|actorMemberId|adminActorId|warningCodes|credential/,
    );
    expect(JSON.stringify(input)).toBe(before);
  });
  it('retains saved unconfigured groups without inventing available capacity or a forced-pick marker from a departure', () => {
    const view = projectPresentationADays(fixture());
    const saved = view.groups.find((group) => group.shift === 'A' && group.value === 'G2');
    expect(saved).toMatchObject({
      saved_override: true,
      maximum: null,
      remaining: null,
      used: 1,
      members: [{ member_id: 2, position_id: 'A002', forced: false }],
    });
    expect(saved?.capacities.find((cap) => cap.id === 'constraint:scope')).toMatchObject({
      used: 1,
      maximum: null,
      remaining: null,
    });
    expect(saved?.capacities.every((cap) => cap.maximum === null && cap.remaining === null)).toBe(
      true,
    );
  });
  it('shows declared total/officer limits independently and never derives a firefighter quota by subtraction', () => {
    const input = fixture();
    const annual =
      input.snapshot.settings.v === 3
        ? input.snapshot.settings.livePolicy.annualOperations
        : undefined;
    if (!annual?.aDay.execution) throw new Error('Synthetic policy missing');
    annual.aDay.max = 8;
    annual.aDay.execution.officersPerGroup = 2;
    input.aDay.groupCaps.A.G1.max = 8;
    input.aDay.groupCaps.A.G1.officerMode = 'EXACT';
    input.aDay.groupCaps.A.G1.officersRequired = 2;
    const first = projectPresentationADays(input).groups.find(
      (group) => group.shift === 'A' && group.value === 'G1',
    );
    expect(first).toMatchObject({ maximum: 8, remaining: 7, used: 1 });
    expect(first?.capacities.find((cap) => cap.pool === 'OFC')).toMatchObject({
      maximum: 2,
      remaining: 2,
    });
    expect(first?.capacities.find((cap) => cap.pool === 'FF')).toMatchObject({
      maximum: null,
      remaining: null,
    });
  });
  it('uses only picks bound to the current seat and preserves actually configured Days capacity', () => {
    const input = fixture();
    input.aDay.weekdayCaps = { ...input.aDay.weekdayCaps, MON: { max: 2 } };
    input.aDay.phase1 = [[4, { positionId: 'obsolete-days-seat', shift: 'D' }]];
    const view = projectPresentationADays(input);
    expect(view.pending.map((member) => member.member_id)).toEqual([3, 4]);
    expect(view.groups.find((group) => group.shift === 'D' && group.value === 'MON')).toMatchObject(
      { maximum: 2, remaining: 2, used: 0 },
    );
  });
  it('counts optional membership only when actually selected', () => {
    const input = fixture();
    const fill = input.fills.A001;
    if (!fill) throw new Error('Synthetic fill missing');
    fill.membershipIds = ['qualified'];
    const group = projectPresentationADays(input).groups.find(
      (entry) => entry.shift === 'A' && entry.value === 'G1',
    );
    expect(group?.capacities.find((cap) => cap.id === 'membership:qualified')).toMatchObject({
      used: 1,
      remaining: 1,
    });
  });
  it('retains unknown choices without a pending prompt when their canonical rights are completed', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const view = projectPresentationADays({ ...input, pendingMemberIds: [] });
    expect(view.pending).toEqual([]);
    expect(
      view.groups.flatMap((group) => group.members).some((member) => member.member_id === 3),
    ).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('fails conflicting stored picks closed instead of mixing a historical selection into a canonical group', () => {
    const input = fixture();
    input.aDay.phase1 = [[1, { positionId: 'A001', shift: 'A' }]];
    input.aDay.picks = [
      { memberId: 1, shift: 'A', aDay: 'G2', pickedAtMs: 1, forced: false, adminActorId: null },
    ];
    expect(projectPresentationADays(input)).toMatchObject({
      availability: 'UNAVAILABLE',
      groups: [],
      pending: [],
      code: 'A_DAY_PRESENTATION_PICK_CONFLICT',
    });
  });
});
