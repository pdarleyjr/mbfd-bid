import {
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  type LiveBidCommand,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { reduceLiveBidCommand } from '../../src/commands/live-bid-reducer.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';

const policy: FrozenLiveBidPolicy = {
  v: 1,
  policyRevision: 'policy-1',
  stages: [
    {
      id: 'd',
      label: 'D',
      order: 0,
      memberIds: [1, 2],
      opportunityPositionIds: ['p1', 'p2'],
      kind: 'D_SHIFT',
    },
  ],
  dispositions: (['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const).map(
    (disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: disposition === 'DECLINED',
      requiresReason: true,
      requiresEvidence: disposition === 'UNREACHABLE',
      contactPolicyReference: null,
    }),
  ),
  actionPermissions: (
    [
      'record_selection',
      'amend_selection',
      'skip_defer',
      'mark_unreachable',
      'force',
      'resolve_tie',
      'alter_order',
      'pause_resume',
      'create_live_session',
      'approve_transition',
      'approve_final_results',
      'publish',
    ] as const
  ).map((action) => ({ action, actorMemberIds: [99] })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
};
function state(): BidSessionState {
  return {
    ...emptyBidSessionState('s'),
    currentPhase: 'position_bid' as const,
    currentBidderId: 1,
    bidOrder: [
      { ordinal: 1, memberId: 1, pool: 'FF' as const, stageId: 'd' },
      { ordinal: 2, memberId: 2, pool: 'FF' as const, stageId: 'd' },
    ],
    live: {
      currentStageId: 'd',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
  };
}
function command(
  type: LiveBidCommand['type'],
  extra: Record<string, unknown> = {},
): LiveBidCommand {
  return {
    v: 1,
    type,
    commandId: '00000000-0000-4000-8000-000000000001',
    bidSessionId: 's',
    expectedSeq: 0,
    actor: { id: 99, role: 'admin' },
    reason: 'operator reason',
    evidenceReference: null,
    ...extra,
  } as LiveBidCommand;
}

type UnreachablePath = 'declaration' | 'disposition' | 'specialty';
function contactPolicy(
  contact: NonNullable<FrozenLiveBidPolicy['annualOperations']>['contact'],
): FrozenLiveBidPolicy {
  return {
    ...policy,
    annualOperations: {
      v: 1,
      stageOrder: ['d'],
      requiredTopologyPositionIds: ['p1'],
      contact,
      specialties: [
        {
          id: 'synthetic-contact-specialty',
          label: 'Synthetic contact specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: ['p1'],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['RSC_SENIORITY'],
        },
      ],
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 1,
        max: 2,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
      },
    },
  };
}

function unreachableScenario(
  path: UnreachablePath,
  configured: FrozenLiveBidPolicy,
  attempts: Array<{ memberId: number; atMs: number }>,
) {
  let current = state();
  if (path === 'specialty') {
    const started = reduceLiveBidCommand(
      current,
      configured,
      command('live.start_specialty_adjudication', {
        specialtyId: 'synthetic-contact-specialty',
        positionId: 'p1',
        candidateMemberIds: [2],
      }),
      500,
      'synthetic-contact-start',
    );
    if (!started.ok) throw new Error(started.code);
    current = started.state;
  }
  for (const [index, attempt] of attempts.entries()) {
    const recorded = reduceLiveBidCommand(
      current,
      configured,
      command('live.record_contact_attempt', {
        expectedSeq: current.lastSeq,
        commandId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        memberId: attempt.memberId,
        method: index % 2 === 0 ? 'PHONE' : 'TEXT',
      }),
      attempt.atMs,
      `synthetic-contact-${index}`,
    );
    if (!recorded.ok) throw new Error(recorded.code);
    current = recorded.state;
  }
  const input =
    path === 'specialty'
      ? command('live.resolve_specialty_candidate', {
          memberId: 2,
          outcome: 'UNREACHABLE',
          evidenceReference: 'synthetic-contact-evidence',
          expectedSeq: current.lastSeq,
        })
      : path === 'disposition'
        ? command('live.disposition', {
            disposition: 'UNREACHABLE',
            evidenceReference: 'synthetic-contact-evidence',
            expectedSeq: current.lastSeq,
          })
        : command('live.declare_unreachable', {
            memberId: 1,
            evidenceReference: 'synthetic-contact-evidence',
            expectedSeq: current.lastSeq,
          });
  return { current, input };
}

describe.each(['declaration', 'disposition', 'specialty'] as const)(
  'canonical unreachable contact gate: %s',
  (path) => {
    const targetId = path === 'specialty' ? 2 : 1;
    const otherId = targetId === 1 ? 2 : 1;
    it('rejects one millisecond before HARD_MINIMUM and accepts the exact boundary from this member first attempt', () => {
      const configured = contactPolicy({
        minimumAttempts: 2,
        timingMode: 'HARD_MINIMUM',
        durationSeconds: 60,
      });
      const { current, input } = unreachableScenario(path, configured, [
        { memberId: otherId, atMs: 1_000 },
        { memberId: targetId, atMs: 10_000 },
        { memberId: targetId, atMs: 11_000 },
      ]);
      const original = structuredClone(current);
      expect(
        reduceLiveBidCommand(current, configured, input, 69_999, 'synthetic-too-early'),
      ).toMatchObject({ ok: false, code: 'CONTACT_MINIMUM_TIME_INCOMPLETE' });
      expect(current).toEqual(original);
      const accepted = reduceLiveBidCommand(
        current,
        configured,
        input,
        70_000,
        'synthetic-boundary',
      );
      if (!accepted.ok) throw new Error(accepted.code);
      expect(accepted.state.lastSeq).toBe(current.lastSeq + 1);
      if (path === 'declaration')
        expect(accepted.state.annual?.unresolvedMemberIds).toContain(targetId);
      if (path === 'disposition') expect(accepted.state.currentBidderId).toBe(2);
      if (path === 'specialty') expect(accepted.state.live?.specialty).toBeNull();
    });

    it('does not enforce TARGET duration as a hard minimum after the required attempts', () => {
      const configured = contactPolicy({
        minimumAttempts: 2,
        timingMode: 'TARGET',
        durationSeconds: 60,
      });
      const { current, input } = unreachableScenario(path, configured, [
        { memberId: targetId, atMs: 10_000 },
        { memberId: targetId, atMs: 11_000 },
      ]);
      expect(
        reduceLiveBidCommand(current, configured, input, 11_000, 'synthetic-target'),
      ).toMatchObject({ ok: true });
    });

    it('never borrows contact attempts from another member', () => {
      const configured = contactPolicy({
        minimumAttempts: 2,
        timingMode: 'OPERATOR_DISCRETION',
        durationSeconds: null,
      });
      const { current, input } = unreachableScenario(path, configured, [
        { memberId: otherId, atMs: 10_000 },
        { memberId: otherId, atMs: 11_000 },
      ]);
      expect(
        reduceLiveBidCommand(current, configured, input, 100_000, 'synthetic-wrong-member'),
      ).toMatchObject({ ok: false, code: 'CONTACT_ATTEMPTS_INCOMPLETE' });
    });

    it('honors an explicit zero-attempt OPERATOR_DISCRETION source policy', () => {
      const configured = contactPolicy({
        minimumAttempts: 0,
        timingMode: 'OPERATOR_DISCRETION',
        durationSeconds: null,
      });
      expect(FrozenLiveBidPolicySchema.parse(configured)).toMatchObject({
        annualOperations: { contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION' } },
      });
      const { current, input } = unreachableScenario(path, configured, []);
      expect(
        reduceLiveBidCommand(current, configured, input, 10_000, 'synthetic-zero-attempts'),
      ).toMatchObject({ ok: true });
    });
  },
);
describe.each(['DECLINE', 'UNREACHABLE'] as const)(
  'fallback %s disposition safeguards',
  (outcome) => {
    const disposition = outcome === 'DECLINE' ? 'DECLINED' : 'UNREACHABLE';
    const configured: FrozenLiveBidPolicy = {
      ...contactPolicy({
        minimumAttempts: 0,
        timingMode: 'OPERATOR_DISCRETION',
        durationSeconds: null,
      }),
      dispositions: policy.dispositions.map((rule) => ({
        ...rule,
        requiresEvidence: true,
        requiresReason: true,
      })),
    };
    const input = (extra: Record<string, unknown> = {}) =>
      command('live.record_fallback_response', {
        fallback: { policyId: 'synthetic-fallback', tierId: 'synthetic-voluntary' },
        positionId: 'p1',
        memberId: 1,
        outcome,
        evidenceReference: 'synthetic-contact-record',
        ...extra,
      });

    it.each([{ evidenceReference: null }, { reason: '   ' }])(
      'does not exhaust a candidate without configured response support: %j',
      (missing) => {
        const current = state();
        const before = structuredClone(current);
        expect(
          reduceLiveBidCommand(current, configured, input(missing), 10_000, 'synthetic-bid', true),
        ).toEqual({ ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' });
        expect(current).toEqual(before);
      },
    );

    it('rejects a missing frozen disposition instead of recording an exhaustion response', () => {
      const incomplete = {
        ...configured,
        dispositions: configured.dispositions.filter((rule) => rule.disposition !== disposition),
      };
      expect(
        reduceLiveBidCommand(state(), incomplete, input(), 10_000, 'synthetic-bid', true),
      ).toEqual({ ok: false, code: 'LIVE_DISPOSITION_POLICY_INCOMPLETE' });
    });

    it('records a supported response without advancing the bidder or awarding the position', () => {
      const current = state();
      const result = reduceLiveBidCommand(
        current,
        configured,
        input(),
        10_000,
        'synthetic-bid',
        true,
      );
      expect(result).toMatchObject({
        ok: true,
        state: {
          currentBidderId: current.currentBidderId,
          fills: current.fills,
          lastSeq: current.lastSeq + 1,
          live: {
            fallbackResponses: [
              {
                policyId: 'synthetic-fallback',
                tierId: 'synthetic-voluntary',
                positionId: 'p1',
                memberId: 1,
                outcome,
                reason: 'operator reason',
                evidenceReference: 'synthetic-contact-record',
              },
            ],
          },
        },
      });
    });
  },
);

describe('live canonical reducer', () => {
  it.each(['selection', 'disposition'] as const)(
    'skips an ahead-of-turn forced award when the ordinary bidder advances by %s',
    (advanceBy) => {
      const configured: FrozenLiveBidPolicy = {
        ...policy,
        stages: policy.stages.map((stage) => ({
          ...stage,
          memberIds: [1, 2, 3],
          opportunityPositionIds: ['p1', 'p2', 'p3'],
        })),
      };
      const initial = state();
      initial.bidOrder = [
        ...initial.bidOrder,
        { ordinal: 3, memberId: 3, pool: 'FF', stageId: 'd' },
      ];
      const forced = reduceLiveBidCommand(
        initial,
        configured,
        command('live.force_selection', { memberId: 2, positionId: 'p2' }),
        100,
        'forced-two',
      );
      if (!forced.ok) throw new Error(forced.code);
      expect(forced.state).toMatchObject({ currentBidderId: 1, queueCursor: 0 });
      const advanced = reduceLiveBidCommand(
        forced.state,
        configured,
        advanceBy === 'selection'
          ? command('live.record_selection', {
              expectedSeq: forced.state.lastSeq,
              memberId: 1,
              positionId: 'p1',
            })
          : command('live.disposition', {
              expectedSeq: forced.state.lastSeq,
              disposition: 'PASS',
            }),
        101,
        'ordinary-one',
      );
      if (!advanced.ok) throw new Error(advanced.code);
      expect(advanced.state).toMatchObject({
        currentBidderId: 3,
        queueCursor: 2,
        currentPhase: 'position_bid',
        turnStartedAtMs: 101,
      });
      expect(advanced.state.bidOrder).toEqual(initial.bidOrder);
      expect(advanced.state.fills.p2).toEqual({ memberId: 2, ordinal: 2, bidId: 'forced-two' });
      const last = reduceLiveBidCommand(
        advanced.state,
        configured,
        command('live.record_selection', {
          expectedSeq: advanced.state.lastSeq,
          memberId: 3,
          positionId: 'p3',
        }),
        102,
        'ordinary-three',
      );
      if (!last.ok) throw new Error(last.code);
      expect(last.state).toMatchObject({ currentBidderId: null, currentPhase: 'complete' });
      expect(last.state.fills.p2).toEqual(forced.state.fills.p2);
    },
  );

  it('retains an ordinary unreachable disposition as unresolved after queue exhaustion and blocks completion', () => {
    const configured = contactPolicy({
      minimumAttempts: 0,
      timingMode: 'OPERATOR_DISCRETION',
      durationSeconds: null,
    });
    const { current, input } = unreachableScenario('disposition', configured, []);
    const unreachable = reduceLiveBidCommand(current, configured, input, 100, 'unreachable-one');
    if (!unreachable.ok) throw new Error(unreachable.code);
    expect(unreachable.state).toMatchObject({
      currentBidderId: 2,
      annual: { unresolvedMemberIds: [1] },
      live: { dispositions: [{ memberId: 1, disposition: 'UNREACHABLE' }] },
    });
    const selected = reduceLiveBidCommand(
      unreachable.state,
      configured,
      command('live.record_selection', {
        expectedSeq: unreachable.state.lastSeq,
        memberId: 2,
        positionId: 'p1',
      }),
      101,
      'ordinary-two',
    );
    if (!selected.ok) throw new Error(selected.code);
    expect(selected.state).toMatchObject({
      currentBidderId: null,
      currentPhase: 'complete',
      annual: { unresolvedMemberIds: [1], completion: null },
    });
    const before = structuredClone(selected.state);
    expect(
      reduceLiveBidCommand(
        selected.state,
        configured,
        command('live.complete_session', { expectedSeq: selected.state.lastSeq }),
        102,
        'completion-rejected',
      ),
    ).toMatchObject({ ok: false, code: 'UNRESOLVED_MEMBERS_BLOCK_COMPLETION' });
    expect(selected.state).toEqual(before);
  });

  it('suspends the exact normal bidder for frozen specialty adjudication and resumes without queue rewind', () => {
    const specialtyPolicy: FrozenLiveBidPolicy = {
      ...policy,
      annualOperations: {
        v: 1,
        stageOrder: ['d'],
        requiredTopologyPositionIds: ['p1'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['p1'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [{ credentialName: 'Marine', value: 8 }],
            tieBreakChain: ['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      },
    };
    const started = reduceLiveBidCommand(
      state(),
      specialtyPolicy,
      command('live.start_specialty_adjudication', {
        specialtyId: 'marine',
        positionId: 'p1',
        candidateMemberIds: [2],
      }),
      100,
      'specialty-start',
    );
    if (!started.ok) throw new Error(started.code);
    expect(started.state.live?.specialty?.suspendedBidderId).toBe(1);
    expect(
      reduceLiveBidCommand(
        started.state,
        specialtyPolicy,
        command('live.record_selection', { memberId: 1, positionId: 'p1' }),
        101,
        'blocked-pick',
      ),
    ).toMatchObject({ ok: false, code: 'SPECIALTY_ADJUDICATION_ACTIVE' });
    const resolved = reduceLiveBidCommand(
      started.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', { memberId: 2, outcome: 'ACCEPT' }),
      102,
      'specialty-award',
    );
    if (!resolved.ok) throw new Error(resolved.code);
    expect(resolved.state).toMatchObject({
      currentBidderId: 1,
      fills: { p1: { memberId: 2, bidId: 'specialty-award' } },
      bidOrder: [{ memberId: 1 }],
      live: { specialty: null },
    });
  });

  it('supersedes a specialty candidate previous award without losing its bid ordinal', () => {
    const specialtyPolicy: FrozenLiveBidPolicy = {
      ...policy,
      annualOperations: {
        v: 1,
        stageOrder: ['d'],
        requiredTopologyPositionIds: ['p1'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['p1'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [],
            tieBreakChain: ['RSC_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      },
    };
    const priorAward = {
      ...state(),
      bidOrder: [{ ordinal: 1, memberId: 1, pool: 'FF' as const, stageId: 'd' }],
      fills: { p2: { memberId: 2, ordinal: 2, bidId: 'prior-award' } },
    };
    const started = reduceLiveBidCommand(
      priorAward,
      specialtyPolicy,
      command('live.start_specialty_adjudication', {
        specialtyId: 'marine',
        positionId: 'p1',
        candidateMemberIds: [2],
      }),
      100,
      'specialty-start',
    );
    if (!started.ok) throw new Error(started.code);

    const resolved = reduceLiveBidCommand(
      started.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', { memberId: 2, outcome: 'ACCEPT' }),
      101,
      'specialty-replacement',
    );
    if (!resolved.ok) throw new Error(resolved.code);
    expect(resolved.state.fills).toEqual({
      p1: { memberId: 2, ordinal: 2, bidId: 'specialty-replacement' },
    });
    expect(resolved.supersedesBidId).toBe('prior-award');
    expect(resolved.payload).toMatchObject({
      releasedPositionId: 'p2',
      supersedesBidId: 'prior-award',
      replacementBidId: 'specialty-replacement',
      removedFromRemainingOrder: false,
    });
  });

  it('holds the department presentation without pausing the bid', () => {
    const held = reduceLiveBidCommand(
      state(),
      policy,
      command('live.set_presentation_mode', { mode: 'HOLD' }),
      100,
      'presentation-hold',
    );
    if (!held.ok) throw new Error(held.code);
    expect(held.state).toMatchObject({
      currentPhase: 'position_bid',
      live: {
        presentation: { mode: 'HOLD', heldAtSeq: 0, heldProjection: { currentBidderId: 1 } },
      },
    });
  });

  it('keeps the exact original bidder active after specialty decline and exhaustion', () => {
    const specialtyPolicy: FrozenLiveBidPolicy = {
      ...policy,
      annualOperations: {
        v: 1,
        stageOrder: ['d'],
        requiredTopologyPositionIds: ['p1'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['p1'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [],
            tieBreakChain: ['RSC_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 18,
          max: 19,
          captainDcMax: 2,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
        },
      },
    };
    const started = reduceLiveBidCommand(
      state(),
      specialtyPolicy,
      command('live.start_specialty_adjudication', {
        specialtyId: 'marine',
        positionId: 'p1',
        candidateMemberIds: [2, 3],
      }),
      100,
      'start',
    );
    if (!started.ok) throw new Error(started.code);
    const firstDecline = reduceLiveBidCommand(
      started.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', {
        expectedSeq: 1,
        memberId: 2,
        outcome: 'DECLINE',
      }),
      101,
      'decline-one',
    );
    if (!firstDecline.ok) throw new Error(firstDecline.code);
    expect(firstDecline.state.live?.specialty).toMatchObject({
      candidateCursor: 1,
      suspendedBidderId: 1,
    });
    const premature = reduceLiveBidCommand(
      firstDecline.state,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', {
        expectedSeq: 2,
        memberId: 3,
        outcome: 'UNREACHABLE',
        evidenceReference: 'contact-log-3',
      }),
      102,
      'decline-two',
    );
    expect(premature).toMatchObject({ ok: false, code: 'CONTACT_ATTEMPTS_INCOMPLETE' });
    let contacted = firstDecline.state;
    for (const index of [0, 1, 2]) {
      const attempt = reduceLiveBidCommand(
        contacted,
        specialtyPolicy,
        command('live.record_contact_attempt', {
          commandId: `10000000-0000-4000-8000-00000000000${index}`,
          expectedSeq: contacted.lastSeq,
          memberId: 3,
          method: index === 1 ? 'TEXT' : 'PHONE',
        }),
        102 + index,
        `contact-${index}`,
      );
      if (!attempt.ok) throw new Error(attempt.code);
      contacted = attempt.state;
    }
    const exhausted = reduceLiveBidCommand(
      contacted,
      specialtyPolicy,
      command('live.resolve_specialty_candidate', {
        expectedSeq: contacted.lastSeq,
        memberId: 3,
        outcome: 'UNREACHABLE',
        evidenceReference: 'contact-log-3',
      }),
      106,
      'decline-two',
    );
    if (!exhausted.ok) throw new Error(exhausted.code);
    expect(exhausted.state).toMatchObject({
      currentBidderId: 1,
      live: { specialty: null },
      fills: {},
    });
  });

  it('records a staged selection and seals it after the next selection', () => {
    const first = reduceLiveBidCommand(
      state(),
      policy,
      command('live.record_selection', { memberId: 1, positionId: 'p1' }),
      100,
      'b1',
    );
    if (!first.ok) throw new Error(first.code);
    expect(first.state.currentBidderId).toBe(2);
    const second = reduceLiveBidCommand(
      first.state,
      policy,
      command('live.record_selection', {
        commandId: '00000000-0000-4000-8000-000000000002',
        expectedSeq: 1,
        memberId: 2,
        positionId: 'p2',
      }),
      101,
      'b2',
    );
    if (!second.ok) throw new Error(second.code);
    expect(second.state.live?.lastSelectionBidId).toBe('b2');
    const amended = reduceLiveBidCommand(
      second.state,
      policy,
      command('live.amend_selection', {
        commandId: '00000000-0000-4000-8000-000000000003',
        expectedSeq: 2,
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }),
      102,
      'b3',
    );
    expect(amended).toMatchObject({ ok: false, code: 'SELECTION_SEALED' });
  });
  it('amends the latest member selection to another eligible open opportunity', () => {
    const selected = reduceLiveBidCommand(
      state(),
      policy,
      command('live.record_selection', { memberId: 1, positionId: 'p1' }),
      100,
      'b1',
    );
    if (!selected.ok) throw new Error(selected.code);

    const amended = reduceLiveBidCommand(
      selected.state,
      policy,
      command('live.amend_selection', {
        commandId: '00000000-0000-4000-8000-000000000003',
        expectedSeq: 1,
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }),
      101,
      'b2',
    );
    if (!amended.ok) throw new Error(amended.code);
    expect(amended.state.fills).toEqual({ p2: { memberId: 1, ordinal: 1, bidId: 'b2' } });
    expect(amended.payload).toMatchObject({
      operation: 'amend_selection',
      memberId: 1,
      fromPositionId: 'p1',
      toPositionId: 'p2',
      supersedesBidId: 'b1',
      replacementBidId: 'b2',
    });
  });

  it('alters only the uncommitted order and preserves frozen member entries', () => {
    const result = reduceLiveBidCommand(
      state(),
      policy,
      command('live.alter_order', { orderedRemainingMemberIds: [2, 1] }),
      100,
      'unused',
    );
    if (!result.ok) throw new Error(result.code);
    expect(result.state.bidOrder.map((entry) => entry.memberId)).toEqual([2, 1]);
    expect(result.state.currentBidderId).toBe(2);
    expect(result.payload).toMatchObject({
      operation: 'alter_order',
      beforeMemberIds: [1, 2],
      afterMemberIds: [2, 1],
    });
  });

  it('rejects an altered order that drops a remaining member', () => {
    const result = reduceLiveBidCommand(
      state(),
      policy,
      command('live.alter_order', { orderedRemainingMemberIds: [2] }),
      100,
      'unused',
    );
    expect(result).toMatchObject({ ok: false, code: 'ALTER_ORDER_MEMBER_SET_MISMATCH' });
  });
  it('fails closed when a required disposition evidence pointer is absent', () => {
    const result = reduceLiveBidCommand(
      state(),
      policy,
      command('live.disposition', { disposition: 'UNREACHABLE' }),
      100,
      'b1',
    );
    expect(result).toMatchObject({ ok: false, code: 'DISPOSITION_EVIDENCE_REQUIRED' });
  });
  it('does not mark a completed session ready for finalization without frozen annual policy', () => {
    const result = reduceLiveBidCommand(
      { ...state(), currentPhase: 'complete' },
      policy,
      command('live.complete_session', {
        commandId: '00000000-0000-4000-8000-000000000099',
        expectedSeq: 0,
      }),
      100,
      'b-final',
    );
    expect(result).toMatchObject({ ok: false, code: 'ANNUAL_OPERATIONS_POLICY_MISSING' });
  });
  it('seals completed annual results against later amendments', () => {
    const initial = state();
    const live = initial.live;
    if (live === null || live === undefined) throw new Error('fixture live state missing');
    const result = reduceLiveBidCommand(
      {
        ...initial,
        currentPhase: 'complete',
        fills: { p1: { memberId: 1, ordinal: 1, bidId: 'b1' } },
        live: {
          ...live,
          lastSelectionBidId: 'b1',
        },
        annual: {
          preferenceSheets: [],
          contactAttempts: [],
          unresolvedMemberIds: [],
          returnedAtCurrentSequence: [],
          returningMemberId: null,
          checkpoint: null,
          completion: { readyForFinalizationAtMs: 100, actorMemberId: 99 },
        },
      },
      policy,
      command('live.amend_selection', {
        commandId: '00000000-0000-4000-8000-000000000100',
        memberId: 1,
        fromPositionId: 'p1',
        toPositionId: 'p2',
      }),
      101,
      'b2',
    );
    expect(result).toMatchObject({ ok: false, code: 'ANNUAL_COMPLETION_SEALED' });
  });
  it('records three minimal contact attempts and returns an unreachable member without rewinding the order', () => {
    let current = state();
    for (const [index, method] of ['PHONE', 'TEXT', 'PHONE'].entries()) {
      const result = reduceLiveBidCommand(
        current,
        {
          ...policy,
          annualOperations: {
            v: 1,
            stageOrder: ['d'],
            requiredTopologyPositionIds: ['p1'],
            contact: {
              minimumAttempts: 3,
              timingMode: 'OPERATOR_DISCRETION',
              durationSeconds: null,
            },
            aDay: {
              combatGroups: ['G1', 'G2', 'G3', 'G4'],
              min: 18,
              max: 19,
              captainDcMax: 2,
              specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
            },
          },
        },
        command('live.record_contact_attempt', {
          commandId: `00000000-0000-4000-8000-00000000000${index + 4}`,
          expectedSeq: index,
          memberId: 1,
          method,
        }),
        100 + index,
        `b${index + 4}`,
      );
      if (!result.ok) throw new Error(result.code);
      current = result.state;
    }
    const unreachable = reduceLiveBidCommand(
      current,
      {
        ...policy,
        annualOperations: {
          v: 1,
          stageOrder: ['d'],
          requiredTopologyPositionIds: ['p1'],
          contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: 18,
            max: 19,
            captainDcMax: 2,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
          },
        },
      },
      command('live.declare_unreachable', {
        commandId: '00000000-0000-4000-8000-000000000007',
        expectedSeq: 3,
        memberId: 1,
      }),
      104,
      'b7',
    );
    if (!unreachable.ok) throw new Error(unreachable.code);
    const returned = reduceLiveBidCommand(
      unreachable.state,
      {
        ...policy,
        annualOperations: {
          v: 1,
          stageOrder: ['d'],
          requiredTopologyPositionIds: ['p1'],
          contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: 18,
            max: 19,
            captainDcMax: 2,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
          },
        },
      },
      command('live.return_at_current_sequence', {
        commandId: '00000000-0000-4000-8000-000000000008',
        expectedSeq: 4,
        memberId: 1,
      }),
      105,
      'b8',
    );
    expect(returned).toMatchObject({ ok: true });
    if (!returned.ok) return;
    expect(returned.state.currentBidderId).toBe(1);
    expect(returned.state.bidOrder).toHaveLength(2);
    expect(returned.state.annual?.returnedAtCurrentSequence).toEqual([
      { memberId: 1, sequence: 4 },
    ]);
    expect(returned.state.annual?.returningMemberId).toBe(1);
  });
});
