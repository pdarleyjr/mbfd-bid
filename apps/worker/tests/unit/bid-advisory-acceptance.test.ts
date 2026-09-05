import { BidAdvisoryBundleSchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';

import {
  type BidAdvisoryComposerInput,
  composeBidAdvisoryBundle,
} from '../../src/lib/bid-advisory-composer.js';

const PHASES = ['config', 'position_bid', 'a_day_bid', 'paused', 'complete'] as const;
const PHASE_TEXT = {
  config: 'Session configuration is active',
  position_bid: 'Position bidding is active',
  a_day_bid: 'A-Day bidding is active',
  paused: 'Bidding is paused',
  complete: 'Bidding is complete',
} as const;

function generatedInput(index: number): BidAdvisoryComposerInput {
  const biddableCount = index % 17;
  const filledCount = index % (biddableCount + 1);
  const unfilledCount = biddableCount - filledCount;
  const ineligibleCount = unfilledCount === 0 ? 0 : index % (unfilledCount + 1);
  const eligibleCount = unfilledCount - ineligibleCount;
  const hasBidder = index % 7 !== 0;
  const displayName = `Employee_${index}`;
  return {
    session: {
      id: `session-${index}`,
      sequence: index,
      phase: PHASES.at(index % PHASES.length) ?? 'config',
      isMock: index % 2 === 0,
      frozen: index % 3 !== 0,
      ruleBookVersion: `rules-${index % 9}`,
      positionTemplateVersion: `positions-${index % 11}`,
      configurationRevision: index % 23,
      acceptedStaffingBaseline: index % 2 !== 0,
    },
    ordering: {
      currentBidder: hasBidder
        ? { memberId: index + 1, displayName, ordinal: (index % 100) + 1 }
        : null,
      onDeckCount: index % 4,
      remainingCount: index % 21,
    },
    positions: {
      biddableCount,
      filledCount,
      unfilledCount,
      currentBidderEligibility: hasBidder
        ? {
            memberId: index + 1,
            eligibleUnfilledCount: eligibleCount,
            ineligibleUnfilledCount: ineligibleCount,
            blockingReasonLabels: ineligibleCount === 0 ? [] : [`UNMAPPED_REASON_${index}`],
          }
        : null,
    },
    specialty:
      hasBidder && index % 4 === 0
        ? {
            specialtyId: `SPECIALTY_${index}`,
            positionId: `POS_${index}`,
            suspendedBidderDisplayName: displayName,
            candidateIndex: 1,
            candidateCount: (index % 5) + 1,
          }
        : null,
    aDay:
      index % 5 === 0
        ? {
            currentBidderDisplayName: hasBidder ? displayName : null,
            eligibleOptionCount: hasBidder ? index % 8 : null,
            fullBucketCount: index % 20,
            bucketCount: 20,
          }
        : null,
    annual:
      index % 3 === 0
        ? {
            unresolvedCount: index % 6,
            returnedAtCurrentSequenceCount: index % 3,
            finalizationReady: index % 12 === 0,
          }
        : null,
  };
}

const DETERMINISTIC_CORPUS = Array.from({ length: 25 }, (_, index) => ({
  name: `authoritative-state-${String(index + 1).padStart(2, '0')}`,
  input: generatedInput(index + 1),
}));

describe('deterministic BID advisory acceptance corpus', () => {
  it.each(DETERMINISTIC_CORPUS)('$name', ({ input }) => {
    const before = JSON.stringify(input);
    const first = composeBidAdvisoryBundle(input);
    const second = composeBidAdvisoryBundle(input);
    const serialized = JSON.stringify(first);

    expect(BidAdvisoryBundleSchema.safeParse(first).success).toBe(true);
    expect(JSON.stringify(second)).toBe(serialized);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.sessionId).toBe(input.session.id);
    expect(first.sequence).toBe(input.session.sequence);
    expect(first.cards.find((card) => card.kind === 'bid_state')?.summary).toContain(
      PHASE_TEXT[input.session.phase],
    );
    expect(serialized).not.toMatch(/\b(?:should|recommend|probably|assume|because|therefore)\b/i);
    expect(serialized).not.toMatch(/award (?:the )?position to|assign (?:the )?position to/i);
    if (input.specialty !== null) {
      expect(serialized).toContain(input.specialty.positionId);
      expect(serialized.match(/POS_\d+/g)).toEqual([input.specialty.positionId]);
    } else {
      expect(serialized).not.toMatch(/POS_\d+/);
    }
  });

  it('holds deterministic, provenance, non-mutation, and no-recommendation invariants for 600 generated states', () => {
    for (let index = 0; index < 600; index += 1) {
      const input = generatedInput(index);
      const before = JSON.stringify(input);
      const first = composeBidAdvisoryBundle(input);
      const serialized = JSON.stringify(first);

      expect(BidAdvisoryBundleSchema.safeParse(first).success).toBe(true);
      expect(JSON.stringify(composeBidAdvisoryBundle(input))).toBe(serialized);
      expect(JSON.stringify(input)).toBe(before);
      expect(first.determinationSource).toBe('authoritative_bid_state');
      expect(first.sessionId).toBe(input.session.id);
      expect(first.sequence).toBe(input.session.sequence);
      expect(serialized).not.toMatch(/\b(?:should|recommend|probably|assume|because|therefore)\b/i);
      expect(serialized).not.toMatch(/award (?:the )?position to|assign (?:the )?position to/i);

      const referencedPositions = serialized.match(/POS_\d+/g) ?? [];
      expect(referencedPositions).toEqual(
        input.specialty === null ? [] : [input.specialty.positionId],
      );
      const referencedEmployees = serialized.match(/Employee_\d+/g) ?? [];
      expect(new Set(referencedEmployees)).toEqual(
        input.ordering.currentBidder === null ? new Set() : new Set([`Employee_${index}`]),
      );

      const reasonLabels = input.positions.currentBidderEligibility?.blockingReasonLabels ?? [];
      for (const reason of reasonLabels) expect(serialized).toContain(reason);
    }
  });
});
