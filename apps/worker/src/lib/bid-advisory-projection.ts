import {
  type ADayState,
  COMBAT_GROUPS,
  type Member,
  WEEKDAYS,
  canPick,
  computeAllMeters,
} from '@mbfd/a-day';
import { type BidAdvisoryBundle, BidAdvisoryBundleSchema } from '@mbfd/shared';

import { hydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type {
  BidSessionState,
  CurrentPhase,
  LiveBidProgress,
  PersistedADayState,
} from '../durable/bid-session-state.js';
import type { AnnualOperationsState } from './annual-bid-operations.js';
import { composeBidAdvisoryBundle } from './bid-advisory-composer.js';
import { type FrozenSessionBidPolicy, eligibilityMemberFromFrozen } from './bid-policy.js';
import { evaluateFrozenOpenPositionEligibility } from './frozen-position-eligibility.js';

interface AdvisoryBidder {
  readonly memberId: number;
  readonly ordinal: number;
  readonly firstName: string;
  readonly lastName: string;
}

export interface AuthoritativeBidAdvisoryProjectionInput {
  readonly sessionId: string;
  readonly sequence: number;
  readonly phase: CurrentPhase;
  readonly isMock: boolean;
  readonly frozenAt: number | null;
  readonly currentBidderId: number | null;
  readonly currentBidder: AdvisoryBidder | null;
  readonly onDeck: readonly AdvisoryBidder[];
  readonly bidOrder: BidSessionState['bidOrder'];
  readonly fills: BidSessionState['fills'];
  readonly aDay: PersistedADayState | null;
  readonly live: LiveBidProgress | null;
  readonly annual: AnnualOperationsState | null;
  readonly frozenPolicy: Extract<FrozenSessionBidPolicy, { ok: true }>;
  readonly memberNames: Readonly<Record<string, { firstName: string; lastName: string }>>;
}

function displayName(member: { firstName: string; lastName: string }): string {
  return `${member.firstName} ${member.lastName}`.trim();
}

function aDayResult(
  input: AuthoritativeBidAdvisoryProjectionInput,
): Parameters<typeof composeBidAdvisoryBundle>[0]['aDay'] {
  if (input.aDay === null) return null;
  const membersById = new Map<number, Member>(
    input.frozenPolicy.snapshot.members
      .filter((member) => member.pool !== 'EXCLUDED')
      .map((member) => [
        member.memberId,
        {
          ...eligibilityMemberFromFrozen(member),
          employeeId: String(member.memberId),
        },
      ]),
  );
  const state: ADayState = hydrateADayState(input.aDay, membersById);
  const meters = computeAllMeters(state);
  const allMeters = [...meters.groups, ...meters.weekdays];
  const currentBidderId = input.currentBidderId;
  let eligibleOptionCount: number | null = null;
  if (currentBidderId !== null) {
    const phaseOne = state.phase1ByMember.get(currentBidderId);
    const options: readonly string[] = phaseOne?.shift === 'D' ? WEEKDAYS : COMBAT_GROUPS;
    eligibleOptionCount = options.filter(
      (value) => canPick(state, currentBidderId, value as never).ok,
    ).length;
  }
  return {
    currentBidderDisplayName:
      input.currentBidder === null ? null : displayName(input.currentBidder),
    eligibleOptionCount,
    fullBucketCount: allMeters.filter((entry) => entry.meter.isFull).length,
    bucketCount: allMeters.length,
  };
}

/**
 * Converts the already-authoritative board projection into typed composer
 * facts. Business determinations are delegated to the existing frozen
 * eligibility and A-Day engines; this function adds no alternative rules.
 */
export function projectAuthoritativeBidAdvisory(
  input: AuthoritativeBidAdvisoryProjectionInput,
): BidAdvisoryBundle {
  const biddablePositions = input.frozenPolicy.snapshot.ruleBookMaterial.positions.filter(
    (position) => position.bidParticipation === 'BIDDABLE',
  );
  const biddableIds = new Set(biddablePositions.map((position) => position.id));
  const filledPositionIds = new Set(
    Object.keys(input.fills).filter((positionId) => biddableIds.has(positionId)),
  );
  const filledMemberIds = new Set(Object.values(input.fills).map((fill) => fill.memberId));
  const remainingCount = input.bidOrder.filter(
    (entry) => !filledMemberIds.has(entry.memberId),
  ).length;

  const eligibility =
    input.currentBidderId === null
      ? null
      : evaluateFrozenOpenPositionEligibility(
          input.frozenPolicy,
          input.currentBidderId,
          filledPositionIds,
        );
  const ineligible = eligibility?.filter((result) => !result.eligible) ?? [];
  const blockingReasonLabels = [
    ...new Set(
      ineligible.flatMap((result) =>
        result.reasons.filter((reason) => !reason.satisfied).map((reason) => reason.label),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));

  const specialty = input.live?.specialty ?? null;
  const suspendedName =
    specialty === null ? undefined : input.memberNames[String(specialty.suspendedBidderId)];
  const bundle = composeBidAdvisoryBundle({
    session: {
      id: input.sessionId,
      sequence: input.sequence,
      phase: input.phase,
      isMock: input.isMock,
      frozen: input.frozenAt !== null,
      ruleBookVersion: input.frozenPolicy.snapshot.ruleBookVersion,
      positionTemplateVersion: input.frozenPolicy.snapshot.positionTemplateVersion,
      configurationRevision: input.frozenPolicy.snapshot.configurationRevision,
      acceptedStaffingBaseline: input.frozenPolicy.snapshot.staffingBaseline !== undefined,
    },
    ordering: {
      currentBidder:
        input.currentBidder === null
          ? null
          : {
              memberId: input.currentBidder.memberId,
              displayName: displayName(input.currentBidder),
              ordinal: input.currentBidder.ordinal,
            },
      onDeckCount: input.onDeck.length,
      remainingCount,
    },
    positions: {
      biddableCount: biddablePositions.length,
      filledCount: filledPositionIds.size,
      unfilledCount: biddablePositions.length - filledPositionIds.size,
      currentBidderEligibility:
        input.currentBidderId === null || eligibility === null
          ? null
          : {
              memberId: input.currentBidderId,
              eligibleUnfilledCount: eligibility.filter((result) => result.eligible).length,
              ineligibleUnfilledCount: ineligible.length,
              blockingReasonLabels,
            },
    },
    specialty:
      specialty === null
        ? null
        : {
            specialtyId: specialty.specialtyId,
            positionId: specialty.positionId,
            suspendedBidderDisplayName:
              suspendedName === undefined
                ? `Member #${specialty.suspendedBidderId}`
                : displayName(suspendedName),
            candidateIndex: specialty.candidateCursor + 1,
            candidateCount: specialty.candidateMemberIds.length,
          },
    aDay: aDayResult(input),
    annual:
      input.annual === null
        ? null
        : {
            unresolvedCount: input.annual.unresolvedMemberIds.length,
            returnedAtCurrentSequenceCount: input.annual.returnedAtCurrentSequence.length,
            finalizationReady: input.annual.completion !== null,
          },
  });

  // Keep the API boundary fail-closed if a future composer change drifts from
  // the shared serialized contract.
  return BidAdvisoryBundleSchema.parse(bundle);
}
