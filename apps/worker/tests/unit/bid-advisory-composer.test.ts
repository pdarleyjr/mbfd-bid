import { describe, expect, it } from 'vitest';

import {
  type BidAdvisoryComposerInput,
  composeBidAdvisoryBundle,
} from '../../src/lib/bid-advisory-composer.js';

function input(overrides: Partial<BidAdvisoryComposerInput> = {}): BidAdvisoryComposerInput {
  return {
    session: {
      id: 'session-1',
      sequence: 12,
      phase: 'position_bid',
      isMock: false,
      frozen: false,
      ruleBookVersion: '2027.3',
      positionTemplateVersion: '2027.2',
      configurationRevision: 4,
      acceptedStaffingBaseline: true,
    },
    ordering: {
      currentBidder: { memberId: 17, displayName: 'Alex Member', ordinal: 4 },
      onDeckCount: 2,
      remainingCount: 3,
    },
    positions: {
      biddableCount: 4,
      filledCount: 1,
      unfilledCount: 3,
      currentBidderEligibility: {
        memberId: 17,
        eligibleUnfilledCount: 2,
        ineligibleUnfilledCount: 1,
        blockingReasonLabels: ['PARAMEDIC_REQUIRED'],
      },
    },
    specialty: null,
    aDay: null,
    annual: { unresolvedCount: 1, returnedAtCurrentSequenceCount: 0, finalizationReady: false },
    ...overrides,
  };
}

describe('composeBidAdvisoryBundle', () => {
  it('explains only the authoritative result facts supplied by the BID read model', () => {
    const bundle = composeBidAdvisoryBundle(input());

    expect(bundle).toMatchObject({
      v: 1,
      determinationSource: 'authoritative_bid_state',
      sessionId: 'session-1',
      sequence: 12,
      ruleBookVersion: '2027.3',
      positionTemplateVersion: '2027.2',
      configurationRevision: 4,
    });
    expect(bundle.cards.map((card) => card.kind)).toEqual([
      'bid_state',
      'candidate_order',
      'position_options',
      'annual_operations',
      'staffing_authority',
    ]);
    expect(bundle.cards.find((card) => card.kind === 'bid_state')?.summary).toBe(
      'Position bidding is active at sequence 12. Alex Member (order 4) is the current bidder.',
    );
    expect(bundle.cards.find((card) => card.kind === 'candidate_order')?.summary).toBe(
      '2 members are on deck; 3 members remain in the frozen candidate order.',
    );
    expect(bundle.cards.find((card) => card.kind === 'position_options')?.summary).toBe(
      "1 of 4 biddable positions is filled; 3 remain unfilled. 2 unfilled positions satisfy Alex Member's frozen eligibility rules. 1 does not: PARAMEDIC_REQUIRED.",
    );
    expect(bundle.cards.find((card) => card.kind === 'staffing_authority')?.summary).toContain(
      'bound to an accepted staffing baseline',
    );

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toMatch(/\b(?:AI|model|prompt|inference)\b/i);
  });

  it('is byte-stable for the same facts and preserves reason labels without expanding them', () => {
    const facts = input();

    expect(JSON.stringify(composeBidAdvisoryBundle(facts))).toBe(
      JSON.stringify(composeBidAdvisoryBundle(facts)),
    );
    const positionSummary = composeBidAdvisoryBundle(facts).cards.find(
      (card) => card.kind === 'position_options',
    )?.summary;
    expect(positionSummary).toContain('PARAMEDIC_REQUIRED');
    expect(positionSummary).not.toContain('Paramedic certification');
  });

  it('distinguishes a frozen policy snapshot from a paused bid session', () => {
    const bundle = composeBidAdvisoryBundle(
      input({ session: { ...input().session, frozen: true } }),
    );
    const state = bundle.cards.find((card) => card.kind === 'bid_state');

    expect(state).toMatchObject({ severity: 'ready' });
    expect(state?.summary).toContain('The policy snapshot is frozen.');
    expect(state?.summary).not.toContain('The session is frozen.');
  });

  it('describes a specialty interruption from frozen specialty state without selecting a winner', () => {
    const bundle = composeBidAdvisoryBundle(
      input({
        specialty: {
          specialtyId: 'marine',
          positionId: 'A101',
          suspendedBidderDisplayName: 'Alex Member',
          candidateIndex: 1,
          candidateCount: 3,
        },
      }),
    );

    expect(bundle.cards.find((card) => card.kind === 'specialty')).toMatchObject({
      severity: 'attention',
      summary:
        "Alex Member's normal turn is suspended for specialty marine at position A101. Candidate 1 of 3 is next in the frozen specialty order.",
      sources: ['specialty_state', 'frozen_policy_snapshot'],
    });
    expect(JSON.stringify(bundle)).not.toMatch(/winner|should award|should select/i);
  });

  it('describes A-Day capacity and mock isolation from the supplied engine result', () => {
    const bundle = composeBidAdvisoryBundle(
      input({
        session: {
          ...input().session,
          phase: 'a_day_bid',
          isMock: true,
          acceptedStaffingBaseline: false,
        },
        aDay: {
          currentBidderDisplayName: 'Alex Member',
          eligibleOptionCount: 2,
          fullBucketCount: 4,
          bucketCount: 19,
        },
        annual: null,
      }),
    );

    expect(bundle.cards.find((card) => card.kind === 'a_day')?.summary).toBe(
      'Alex Member has 2 eligible A-Day options in the authoritative A-Day result; 4 of 19 capacity buckets are full.',
    );
    expect(bundle.cards.find((card) => card.kind === 'mock_boundary')?.summary).toContain(
      'Rehearsal selections remain isolated',
    );
    expect(bundle.cards.find((card) => card.kind === 'staffing_authority')?.summary).toContain(
      'current TeleStaff and canonical records do not replace it',
    );
  });

  it('fails visibly when a live frozen session has no accepted staffing baseline fact', () => {
    const bundle = composeBidAdvisoryBundle(
      input({ session: { ...input().session, acceptedStaffingBaseline: false } }),
    );

    expect(bundle.cards.find((card) => card.kind === 'staffing_authority')).toMatchObject({
      severity: 'blocked',
      summary: 'No accepted staffing baseline is present in this live session snapshot.',
    });
  });
});
