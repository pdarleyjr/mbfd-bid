import { describe, expect, it } from 'vitest';
import {
  type FrozenSpecialtyCoverageAdvisoryInput,
  type FrozenSpecialtyCoverageMember,
  adviseFrozenSpecialtyCoverage,
} from '../../src/lib/specialty-coverage-advisory.js';

const member = (
  memberId: number,
  pool: FrozenSpecialtyCoverageMember['pool'] = 'FF',
): FrozenSpecialtyCoverageMember => ({ memberId, pool });

function coverageInput(
  overrides: Partial<FrozenSpecialtyCoverageAdvisoryInput> = {},
): FrozenSpecialtyCoverageAdvisoryInput {
  return {
    mode: 'mock',
    frozenMembers: [member(1), member(2), member(3), member(4)],
    specialtySeats: [],
    frozenEligibilityEdges: [],
    assignedMemberIds: [],
    ...overrides,
  };
}

describe('adviseFrozenSpecialtyCoverage', () => {
  it('uses an augmenting-path global match instead of a per-seat greedy count', () => {
    const input = coverageInput({
      frozenMembers: [member(1), member(2)],
      specialtySeats: [
        { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
        { seatId: 'marine-2', positionId: 'M-2', ruleGroupId: 'marine', filled: false },
      ],
      frozenEligibilityEdges: [
        { seatId: 'marine-1', memberId: 1 },
        { seatId: 'marine-1', memberId: 2 },
        { seatId: 'marine-2', memberId: 1 },
      ],
    });
    const result = adviseFrozenSpecialtyCoverage(input);

    expect(result).toMatchObject({
      maximumRemainingCoveredCount: 2,
      guaranteedUncoveredSeatCount: 0,
      unmatchedSeatIds: [],
      status: 'AT_RISK',
      matching: [
        { seatId: 'marine-1', memberId: 2 },
        { seatId: 'marine-2', memberId: 1 },
      ],
      criticalMemberIds: [1, 2],
    });
    expect(
      adviseFrozenSpecialtyCoverage({
        ...input,
        specialtySeats: [...input.specialtySeats].reverse(),
        frozenEligibilityEdges: [...input.frozenEligibilityEdges].reverse(),
      }),
    ).toEqual(result);
  });

  it('reports the global shortage when each specialty group has an individually sufficient but overlapping pool', () => {
    const result = adviseFrozenSpecialtyCoverage(
      coverageInput({
        frozenMembers: [member(1), member(2)],
        specialtySeats: [
          { seatId: 'hazmat-1', positionId: 'H-1', ruleGroupId: 'hazmat', filled: false },
          { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
          { seatId: 'rescue-1', positionId: 'R-1', ruleGroupId: 'rescue', filled: false },
        ],
        frozenEligibilityEdges: [
          { seatId: 'hazmat-1', memberId: 1 },
          { seatId: 'hazmat-1', memberId: 2 },
          { seatId: 'marine-1', memberId: 1 },
          { seatId: 'marine-1', memberId: 2 },
          { seatId: 'rescue-1', memberId: 1 },
          { seatId: 'rescue-1', memberId: 2 },
        ],
      }),
    );

    expect(result).toMatchObject({
      totalSpecialtySeatCount: 3,
      filledSpecialtySeatCount: 0,
      remainingSpecialtySeatCount: 3,
      maximumRemainingCoveredCount: 2,
      guaranteedUncoveredSeatCount: 1,
      status: 'SHORTAGE',
      unmatchedSeatIds: ['rescue-1'],
      ruleGroups: [
        expect.objectContaining({ ruleGroupId: 'hazmat', simpleEligibleMemberIds: [1, 2] }),
        expect.objectContaining({ ruleGroupId: 'marine', simpleEligibleMemberIds: [1, 2] }),
        expect.objectContaining({ ruleGroupId: 'rescue', simpleEligibleMemberIds: [1, 2] }),
      ],
    });
  });

  it('reports one guaranteed shortage across two two-seat specialties with only three unique frozen candidates', () => {
    const result = adviseFrozenSpecialtyCoverage(
      coverageInput({
        frozenMembers: [member(1), member(2), member(3)],
        specialtySeats: [
          { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
          { seatId: 'marine-2', positionId: 'M-2', ruleGroupId: 'marine', filled: false },
          { seatId: 'hazmat-1', positionId: 'H-1', ruleGroupId: 'hazmat', filled: false },
          { seatId: 'hazmat-2', positionId: 'H-2', ruleGroupId: 'hazmat', filled: false },
        ],
        frozenEligibilityEdges: [
          ...[1, 2, 3].flatMap((memberId) => [
            { seatId: 'marine-1', memberId },
            { seatId: 'marine-2', memberId },
            { seatId: 'hazmat-1', memberId },
            { seatId: 'hazmat-2', memberId },
          ]),
        ],
      }),
    );

    expect(result).toMatchObject({
      maximumRemainingCoveredCount: 3,
      guaranteedUncoveredSeatCount: 1,
      status: 'SHORTAGE',
    });
  });

  it('identifies coverage-critical frozen members in a fully coverable overlapping specialty graph', () => {
    const result = adviseFrozenSpecialtyCoverage(
      coverageInput({
        specialtySeats: [
          { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
          { seatId: 'marine-2', positionId: 'M-2', ruleGroupId: 'marine', filled: false },
          { seatId: 'hazmat-1', positionId: 'H-1', ruleGroupId: 'hazmat', filled: false },
          { seatId: 'hazmat-2', positionId: 'H-2', ruleGroupId: 'hazmat', filled: false },
        ],
        frozenEligibilityEdges: [
          { seatId: 'marine-1', memberId: 1 },
          { seatId: 'marine-1', memberId: 2 },
          { seatId: 'marine-1', memberId: 3 },
          { seatId: 'marine-2', memberId: 1 },
          { seatId: 'marine-2', memberId: 2 },
          { seatId: 'marine-2', memberId: 3 },
          { seatId: 'hazmat-1', memberId: 1 },
          { seatId: 'hazmat-1', memberId: 2 },
          { seatId: 'hazmat-1', memberId: 4 },
          { seatId: 'hazmat-2', memberId: 1 },
          { seatId: 'hazmat-2', memberId: 2 },
          { seatId: 'hazmat-2', memberId: 4 },
        ],
      }),
    );

    expect(result).toMatchObject({
      maximumRemainingCoveredCount: 4,
      guaranteedUncoveredSeatCount: 0,
      status: 'AT_RISK',
      criticalMemberIds: [1, 2, 3, 4],
    });
  });

  it('removes filled specialty seats and unavailable frozen members before matching', () => {
    const result = adviseFrozenSpecialtyCoverage(
      coverageInput({
        frozenMembers: [member(1, 'EXCLUDED'), member(2), member(3), member(4)],
        specialtySeats: [
          { seatId: 'marine-filled', positionId: 'M-FILLED', ruleGroupId: 'marine', filled: true },
          { seatId: 'marine-open', positionId: 'M-OPEN', ruleGroupId: 'marine', filled: false },
        ],
        frozenEligibilityEdges: [
          { seatId: 'marine-filled', memberId: 1 },
          { seatId: 'marine-open', memberId: 1 },
          { seatId: 'marine-open', memberId: 2 },
          { seatId: 'marine-open', memberId: 3 },
        ],
        assignedMemberIds: [3],
      }),
    );

    expect(result).toMatchObject({
      totalSpecialtySeatCount: 2,
      filledSpecialtySeatCount: 1,
      remainingSpecialtySeatCount: 1,
      maximumRemainingCoveredCount: 1,
      guaranteedUncoveredSeatCount: 0,
      matching: [{ seatId: 'marine-open', memberId: 2 }],
      ruleGroups: [
        {
          ruleGroupId: 'marine',
          totalSeatCount: 2,
          filledSeatCount: 1,
          remainingSeatCount: 1,
          simpleEligibleMemberIds: [2],
        },
      ],
    });
  });

  it('warns only when a current bidder taking a non-specialty seat would reduce global coverage', () => {
    const risk = adviseFrozenSpecialtyCoverage(
      coverageInput({
        frozenMembers: [member(1), member(2)],
        specialtySeats: [
          { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
          { seatId: 'marine-2', positionId: 'M-2', ruleGroupId: 'marine', filled: false },
        ],
        frozenEligibilityEdges: [
          { seatId: 'marine-1', memberId: 1 },
          { seatId: 'marine-1', memberId: 2 },
          { seatId: 'marine-2', memberId: 1 },
          { seatId: 'marine-2', memberId: 2 },
        ],
        currentBidder: { memberId: 1, proposedPositionId: 'ordinary-1' },
      }),
    );
    const safe = adviseFrozenSpecialtyCoverage(
      coverageInput({
        frozenMembers: [member(1), member(2), member(3)],
        specialtySeats: [
          { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
          { seatId: 'marine-2', positionId: 'M-2', ruleGroupId: 'marine', filled: false },
        ],
        frozenEligibilityEdges: [
          { seatId: 'marine-1', memberId: 1 },
          { seatId: 'marine-1', memberId: 2 },
          { seatId: 'marine-1', memberId: 3 },
          { seatId: 'marine-2', memberId: 1 },
          { seatId: 'marine-2', memberId: 2 },
          { seatId: 'marine-2', memberId: 3 },
        ],
        currentBidder: { memberId: 1, proposedPositionId: 'ordinary-1' },
      }),
    );

    expect(risk.currentBidderAdvisory).toEqual({
      kind: 'NON_SPECIALTY_SELECTION_RISK',
      memberId: 1,
      proposedPositionId: 'ordinary-1',
      lostCoverageCount: 1,
      afterSelection: {
        maximumRemainingCoveredCount: 1,
        guaranteedUncoveredSeatCount: 1,
        unmatchedSeatIds: ['marine-2'],
      },
    });
    expect(safe.currentBidderAdvisory).toEqual({
      kind: 'NON_SPECIALTY_SELECTION_SAFE',
      memberId: 1,
      proposedPositionId: 'ordinary-1',
      lostCoverageCount: 0,
      afterSelection: {
        maximumRemainingCoveredCount: 2,
        guaranteedUncoveredSeatCount: 0,
        unmatchedSeatIds: [],
      },
    });
    expect(safe).toMatchObject({ status: 'FEASIBLE', criticalMemberIds: [] });
  });

  it('is mode-neutral for the same frozen run material and does not accept stale graph references', () => {
    const input = coverageInput({
      frozenMembers: [member(1), member(2)],
      specialtySeats: [
        { seatId: 'marine-1', positionId: 'M-1', ruleGroupId: 'marine', filled: false },
      ],
      frozenEligibilityEdges: [
        { seatId: 'marine-1', memberId: 1 },
        { seatId: 'marine-1', memberId: 2 },
      ],
    });

    expect(adviseFrozenSpecialtyCoverage(input)).toEqual(
      adviseFrozenSpecialtyCoverage({ ...input, mode: 'live' }),
    );
    expect(() =>
      adviseFrozenSpecialtyCoverage({
        ...input,
        frozenEligibilityEdges: [{ seatId: 'marine-1', memberId: 999 }],
      }),
    ).toThrow('SPECIALTY_COVERAGE_EDGE_MEMBER_NOT_FROZEN');
  });
});
