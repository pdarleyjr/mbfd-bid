import type { PositionRule, Rank } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { frozenPositionPriorityAdvisory } from '../../src/lib/position-priority-advisory.js';

function fixture(rank: 'CPT' | 'LT' | 'FF', name = 'Air Tech 810') {
  const rule: PositionRule = {
    positionId: 'A203',
    ruleBookVersion: 'synthetic',
    requiredCriteria: { rank: [rank], credentials: ['Minimum'], custom: [] },
    pointsPreference: {
      max: 4,
      items: [{ credential: 'Preference', points: 4, requiresOpsPair: false }],
    },
    tieBreakChain: ['points', 'rsc_seniority'],
  };
  const members = [1, 2, 3, 4].map((memberId) => ({
    memberId,
    pool: rank === 'FF' ? 'FF' : 'OFC',
    rank,
    rscSeniority: memberId,
    rankSeniority: memberId,
    isProbationary: false,
    credentialNames:
      memberId === 3 ? ['Preference'] : memberId === 1 ? ['Minimum'] : ['Minimum', 'Preference'],
    exclusionReason: null,
    authoritativeAssignmentId: null,
  }));
  const snapshot = {
    v: 3,
    settings: { v: 3, livePolicy: { dispositions: [], annualOperations: { specialties: [] } } },
    members,
    credentialEvaluationOn: '2030-01-01',
    operatorIdentityProjection: members.map((member) => ({
      memberId: member.memberId,
      employeeId: String(member.memberId),
      firstName: `Member ${member.memberId}`,
      lastName: 'Synthetic',
      rank: member.rank,
    })),
    ruleBookMaterial: { positions: [{ id: 'A203', positionName: name }] },
  } as unknown as Extract<BidSessionPolicySnapshot, { v: 3 }>;
  const state = { ...emptyBidSessionState('synthetic-advisory'), currentBidderId: 1 };
  return { snapshot, state, memberId: 1, rule, rules: [rule, { ...rule, positionId: 'B203' }] };
}

describe('all-profile frozen priority guidance', () => {
  it.each(['CPT', 'LT', 'FF'] as const)(
    'ranks %s by exact frozen points and keeps qualification minima',
    (rank) => {
      const input = fixture(rank);
      const before = JSON.stringify(input);
      const advisory = frozenPositionPriorityAdvisory(input);
      expect(advisory).toMatchObject({
        mode: 'ADVISORY',
        specialty_id: null,
        specialty_label: 'Air Tech 810',
        higher_priority_candidates: [
          { member_id: 2, points: 4, policy_rank: 1 },
          { member_id: 4, points: 4, policy_rank: 2 },
        ],
        eligible_related_position_ids: ['A203', 'B203'],
        a_day_timing: 'ADMIN_REVIEW',
      });
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it.each(['Captain 5', 'Marine Firefighter', 'Driver Engineer', 'Investigator'])(
    'guides %s without a fabricated interrupting specialty policy',
    (name) => {
      expect(frozenPositionPriorityAdvisory(fixture('FF', name))?.specialty_label).toBe(name);
    },
  );

  it('excludes occupied members, terminal dispositions, different qualification families and filled seats', () => {
    const input = fixture('FF');
    input.state.fills.B203 = { memberId: 2, ordinal: 2, bidId: 'earlier' };
    input.snapshot.settings = {
      ...input.snapshot.settings,
      livePolicy: {
        ...(input.snapshot.settings.v === 3 ? input.snapshot.settings.livePolicy : {}),
        dispositions: [{ disposition: 'DECLINED', terminal: true }],
      },
    } as never;
    input.state.live = {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [
        {
          memberId: 4,
          disposition: 'DECLINED',
          stageId: 'ff',
          reason: 'Terminal decision',
          evidenceReference: null,
        },
      ],
    };
    expect(frozenPositionPriorityAdvisory(input)).toBeNull();
    input.state.live.dispositions = [];
    input.rules.push({
      ...input.rule,
      positionId: 'A202',
      requiredCriteria: { ...input.rule.requiredCriteria, credentials: ['Different minimum'] },
    });
    expect(frozenPositionPriorityAdvisory(input)?.eligible_related_position_ids).toEqual(['A203']);
  });

  it('preserves nonterminal pass rights and excludes active acting duties', () => {
    const input = fixture('FF');
    if (input.snapshot.settings.v !== 3) throw new Error('frozen settings required');
    input.snapshot.settings.livePolicy.dispositions = [
      { disposition: 'PASS', terminal: false },
    ] as never;
    input.state.live = {
      currentStageId: 'ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [
        {
          memberId: 2,
          disposition: 'PASS',
          stageId: 'ff',
          reason: 'Ordinary pass',
          evidenceReference: null,
        },
      ],
      exceptionalAssignments: [
        {
          memberId: 4,
          assignmentId: 'acting',
          commandId: 'direction',
          actorMemberId: 99,
          roleLabel: 'Temporary duty',
          positionId: null,
          reason: 'Direction',
          assignedAtMs: 1,
          releasedAtMs: null,
          releaseCommandId: null,
        },
      ],
    };
    expect(
      frozenPositionPriorityAdvisory(input)?.higher_priority_candidates.map(
        (candidate) => candidate.member_id,
      ),
    ).toEqual([2]);
  });

  it('shows ordinary unscored seats without a priority interruption', () => {
    const input = fixture('FF');
    input.rule.pointsPreference = { max: 0, items: [] };
    expect(frozenPositionPriorityAdvisory(input)).toBeNull();
  });
});
