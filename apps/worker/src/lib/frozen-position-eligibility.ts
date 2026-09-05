import { type EligibilityResult, evaluateEligibility } from '@mbfd/eligibility';

import {
  type FrozenSessionBidPolicy,
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
} from './bid-policy.js';

export interface FrozenPositionEligibilityResult {
  readonly positionId: string;
  readonly eligible: boolean;
  readonly reasons: EligibilityResult['reasons'];
  readonly points: number;
}

/**
 * The shared session-bound eligibility projection used by member responses and
 * administrator advisories. It evaluates only immutable session material and
 * excludes positions already recorded as filled by the canonical read model.
 */
export function evaluateFrozenOpenPositionEligibility(
  frozenPolicy: Extract<FrozenSessionBidPolicy, { ok: true }>,
  memberId: number,
  filledPositionIds: ReadonlySet<string>,
): readonly FrozenPositionEligibilityResult[] | null {
  const member = frozenEligibilityMemberForSession(frozenPolicy.snapshot, memberId);
  if (member === null) return null;

  return frozenPolicy.coverage.rules.flatMap((rule) => {
    if (filledPositionIds.has(rule.positionId)) return [];
    const result = evaluateEligibility(eligibilityMemberFromFrozen(member), rule);
    return [
      {
        positionId: rule.positionId,
        eligible: result.eligible,
        reasons: result.reasons,
        points: result.points,
      },
    ];
  });
}
