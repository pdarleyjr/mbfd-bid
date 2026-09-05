import type { BidAdvisoryBundle, BidAdvisoryCard, BidAdvisorySeverity } from '@mbfd/shared';

import type { CurrentPhase } from '../durable/bid-session-state.js';

export interface BidAdvisoryComposerInput {
  readonly session: {
    readonly id: string;
    readonly sequence: number;
    readonly phase: CurrentPhase;
    readonly isMock: boolean;
    readonly frozen: boolean;
    readonly ruleBookVersion: string;
    readonly positionTemplateVersion: string;
    readonly configurationRevision: number;
    readonly acceptedStaffingBaseline: boolean;
  };
  readonly ordering: {
    readonly currentBidder: {
      readonly memberId: number;
      readonly displayName: string;
      readonly ordinal: number;
    } | null;
    readonly onDeckCount: number;
    readonly remainingCount: number;
  };
  readonly positions: {
    readonly biddableCount: number;
    readonly filledCount: number;
    readonly unfilledCount: number;
    readonly currentBidderEligibility: {
      readonly memberId: number;
      readonly eligibleUnfilledCount: number;
      readonly ineligibleUnfilledCount: number;
      readonly blockingReasonLabels: readonly string[];
    } | null;
  };
  readonly specialty: {
    readonly specialtyId: string;
    readonly positionId: string;
    readonly suspendedBidderDisplayName: string;
    readonly candidateIndex: number;
    readonly candidateCount: number;
  } | null;
  readonly aDay: {
    readonly currentBidderDisplayName: string | null;
    readonly eligibleOptionCount: number | null;
    readonly fullBucketCount: number;
    readonly bucketCount: number;
  } | null;
  readonly annual: {
    readonly unresolvedCount: number;
    readonly returnedAtCurrentSequenceCount: number;
    readonly finalizationReady: boolean;
  } | null;
}

function noun(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function phaseText(phase: CurrentPhase): { text: string; severity: BidAdvisorySeverity } {
  switch (phase) {
    case 'config':
      return { text: 'Session configuration is active', severity: 'attention' };
    case 'position_bid':
      return { text: 'Position bidding is active', severity: 'ready' };
    case 'a_day_bid':
      return { text: 'A-Day bidding is active', severity: 'ready' };
    case 'paused':
      return { text: 'Bidding is paused', severity: 'attention' };
    case 'complete':
      return { text: 'Bidding is complete', severity: 'ready' };
  }
}

function stateCard(input: BidAdvisoryComposerInput): BidAdvisoryCard {
  const phase = phaseText(input.session.phase);
  const bidder = input.ordering.currentBidder;
  const current =
    bidder === null
      ? ' No current bidder is recorded.'
      : ` ${bidder.displayName} (order ${bidder.ordinal}) is the current bidder.`;
  const frozen = input.session.frozen ? ' The policy snapshot is frozen.' : '';
  return {
    kind: 'bid_state',
    severity: phase.severity,
    title: 'Bid state',
    summary: `${phase.text} at sequence ${input.session.sequence}.${current}${frozen}`,
    sources: ['canonical_session_state', 'frozen_policy_snapshot'],
  };
}

function orderCard(input: BidAdvisoryComposerInput): BidAdvisoryCard {
  const { onDeckCount, remainingCount } = input.ordering;
  return {
    kind: 'candidate_order',
    severity: input.ordering.currentBidder === null ? 'attention' : 'info',
    title: 'Candidate order',
    summary: `${onDeckCount} ${noun(onDeckCount, 'member')} ${onDeckCount === 1 ? 'is' : 'are'} on deck; ${remainingCount} ${noun(remainingCount, 'member')} ${remainingCount === 1 ? 'remains' : 'remain'} in the frozen candidate order.`,
    sources: ['candidate_order_result', 'frozen_policy_snapshot'],
  };
}

function positionCard(input: BidAdvisoryComposerInput): BidAdvisoryCard {
  const { biddableCount, filledCount, unfilledCount, currentBidderEligibility } = input.positions;
  const progress = `${filledCount} of ${biddableCount} biddable ${noun(biddableCount, 'position')} ${filledCount === 1 ? 'is' : 'are'} filled; ${unfilledCount} remain unfilled.`;
  if (currentBidderEligibility === null || input.ordering.currentBidder === null) {
    return {
      kind: 'position_options',
      severity: unfilledCount === 0 ? 'ready' : 'attention',
      title: 'Position options',
      summary: `${progress} No current-bidder eligibility result is available in this state.`,
      sources: ['selection_result', 'frozen_policy_snapshot'],
    };
  }

  const eligibleCount = currentBidderEligibility.eligibleUnfilledCount;
  const ineligibleCount = currentBidderEligibility.ineligibleUnfilledCount;
  const reasonText =
    currentBidderEligibility.blockingReasonLabels.length === 0
      ? ''
      : `: ${currentBidderEligibility.blockingReasonLabels.join(', ')}`;
  return {
    kind: 'position_options',
    severity: eligibleCount > 0 ? 'ready' : 'blocked',
    title: 'Position options',
    summary: `${progress} ${eligibleCount} unfilled ${noun(eligibleCount, 'position')} ${eligibleCount === 1 ? 'satisfies' : 'satisfy'} ${input.ordering.currentBidder.displayName}'s frozen eligibility rules. ${ineligibleCount} ${ineligibleCount === 1 ? 'does' : 'do'} not${reasonText}.`,
    sources: ['selection_result', 'eligibility_engine', 'frozen_policy_snapshot'],
  };
}

function specialtyCard(input: BidAdvisoryComposerInput): BidAdvisoryCard | null {
  const specialty = input.specialty;
  if (specialty === null) return null;
  return {
    kind: 'specialty',
    severity: 'attention',
    title: 'Specialty interruption',
    summary: `${specialty.suspendedBidderDisplayName}'s normal turn is suspended for specialty ${specialty.specialtyId} at position ${specialty.positionId}. Candidate ${specialty.candidateIndex} of ${specialty.candidateCount} is next in the frozen specialty order.`,
    sources: ['specialty_state', 'frozen_policy_snapshot'],
  };
}

function aDayCard(input: BidAdvisoryComposerInput): BidAdvisoryCard | null {
  const aDay = input.aDay;
  if (aDay === null) return null;
  const subject = aDay.currentBidderDisplayName ?? 'The current bidder';
  const options =
    aDay.eligibleOptionCount === null
      ? `${subject} has no current-bidder A-Day result in this state`
      : `${subject} has ${aDay.eligibleOptionCount} eligible A-Day ${noun(aDay.eligibleOptionCount, 'option')} in the authoritative A-Day result`;
  return {
    kind: 'a_day',
    severity: aDay.eligibleOptionCount === 0 ? 'blocked' : 'info',
    title: 'A-Day',
    summary: `${options}; ${aDay.fullBucketCount} of ${aDay.bucketCount} capacity buckets are full.`,
    sources: ['a_day_engine', 'canonical_session_state', 'frozen_policy_snapshot'],
  };
}

function annualCard(input: BidAdvisoryComposerInput): BidAdvisoryCard | null {
  const annual = input.annual;
  if (annual === null) return null;
  return {
    kind: 'annual_operations',
    severity: annual.finalizationReady
      ? 'ready'
      : annual.unresolvedCount > 0
        ? 'attention'
        : 'info',
    title: 'Annual operations',
    summary: `${annual.unresolvedCount} ${noun(annual.unresolvedCount, 'member')} ${annual.unresolvedCount === 1 ? 'is' : 'are'} unresolved; ${annual.returnedAtCurrentSequenceCount} ${annual.returnedAtCurrentSequenceCount === 1 ? 'has' : 'have'} returned at the current sequence. Finalization is ${annual.finalizationReady ? 'ready' : 'not ready'}.`,
    sources: ['annual_operations_state', 'canonical_session_state'],
  };
}

function staffingCard(input: BidAdvisoryComposerInput): BidAdvisoryCard {
  if (input.session.isMock) {
    return {
      kind: 'staffing_authority',
      severity: 'info',
      title: 'Staffing authority',
      summary:
        'This rehearsal uses its frozen participant and position snapshot; current TeleStaff and canonical records do not replace it.',
      sources: ['frozen_policy_snapshot', 'mock_session_flag'],
    };
  }
  if (!input.session.acceptedStaffingBaseline) {
    return {
      kind: 'staffing_authority',
      severity: 'blocked',
      title: 'Staffing authority',
      summary: 'No accepted staffing baseline is present in this live session snapshot.',
      sources: ['frozen_policy_snapshot'],
    };
  }
  return {
    kind: 'staffing_authority',
    severity: 'ready',
    title: 'Staffing authority',
    summary:
      'This live session is bound to an accepted staffing baseline and frozen policy revision. Later TeleStaff or canonical-record changes do not replace this session snapshot.',
    sources: ['accepted_staffing_baseline', 'frozen_policy_snapshot'],
  };
}

function mockCard(input: BidAdvisoryComposerInput): BidAdvisoryCard | null {
  if (!input.session.isMock) return null;
  return {
    kind: 'mock_boundary',
    severity: 'info',
    title: 'Mock boundary',
    summary:
      'Rehearsal selections remain isolated from live staffing, live assignments, and portal publication.',
    sources: ['mock_session_flag', 'canonical_session_state'],
  };
}

export function composeBidAdvisoryBundle(input: BidAdvisoryComposerInput): BidAdvisoryBundle {
  const optionalCards = [specialtyCard(input), aDayCard(input), annualCard(input)];
  const mockBoundary = mockCard(input);
  return {
    v: 1,
    determinationSource: 'authoritative_bid_state',
    sessionId: input.session.id,
    sequence: input.session.sequence,
    ruleBookVersion: input.session.ruleBookVersion,
    positionTemplateVersion: input.session.positionTemplateVersion,
    configurationRevision: input.session.configurationRevision,
    cards: [
      stateCard(input),
      orderCard(input),
      positionCard(input),
      ...optionalCards.filter((card): card is BidAdvisoryCard => card !== null),
      staffingCard(input),
      ...(mockBoundary === null ? [] : [mockBoundary]),
    ],
  };
}
