import {
  type BidDefinitionSourceDecision,
  type BidOrderingAuthorityRequest,
  type BidOrderingComparator,
  type FrozenBidOrderingAuthority,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
} from '@mbfd/shared';

export type BidOrderingAuthorityResolutionCode =
  | 'ordering_authority_unconfigured'
  | 'ordering_authority_source_decision_missing'
  | 'ordering_authority_source_decision_unresolved'
  | 'ordering_authority_comparator_mismatch';

export type BidOrderingAuthorityResolution =
  | { ok: true; authority: FrozenBidOrderingAuthority }
  | { ok: false; code: BidOrderingAuthorityResolutionCode };

function sameComparator(left: BidOrderingComparator, right: BidOrderingComparator): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Resolves a saved-definition comparator request only from the exact source
 * decision it names. A sourceRef is never consulted here: it is narrative
 * provenance, while this function needs a resolved, typed decision identity.
 */
export function resolveFrozenBidOrderingAuthority(input: {
  request: BidOrderingAuthorityRequest | undefined;
  sourceDecisions: readonly BidDefinitionSourceDecision[];
}): BidOrderingAuthorityResolution {
  if (input.request === undefined) return { ok: false, code: 'ordering_authority_unconfigured' };
  const request = input.request;
  const decision = input.sourceDecisions.find(
    (candidate) => candidate.issueId === request.sourceDecisionId,
  );
  if (decision === undefined)
    return { ok: false, code: 'ordering_authority_source_decision_missing' };
  if (
    decision.status !== 'RESOLVED' ||
    decision.area !== 'annual-policy' ||
    decision.resolution === undefined ||
    decision.resolution.v !== request.v
  )
    return { ok: false, code: 'ordering_authority_source_decision_unresolved' };
  if (request.v === 2) {
    if (
      decision.resolution.v !== 2 ||
      request.stages.length !== decision.resolution.stages.length ||
      request.stages.some((stage) => {
        const resolved =
          decision.resolution?.v === 2
            ? decision.resolution.stages.find((entry) => entry.stageId === stage.stageId)
            : undefined;
        return !resolved || !sameComparator(stage.comparator, resolved.comparator);
      })
    )
      return { ok: false, code: 'ordering_authority_comparator_mismatch' };
    return {
      ok: true,
      authority: {
        v: 2,
        stages: request.stages,
        sourceDecision: { issueId: decision.issueId, effectiveOn: decision.effectiveOn },
      },
    };
  }
  if (
    decision.resolution.v !== 1 ||
    !sameComparator(request.comparator, decision.resolution.comparator)
  )
    return { ok: false, code: 'ordering_authority_comparator_mismatch' };
  return {
    ok: true,
    authority: {
      v: 1,
      comparator: request.comparator,
      sourceDecision: {
        issueId: decision.issueId,
        effectiveOn: decision.effectiveOn,
      },
    },
  };
}

/**
 * A raw policy may be read from an editable source. Strip any authority-shaped
 * field until the definition compiler has resolved and frozen the separate
 * source-decision identity. This keeps Mock/legacy execution on its historical
 * RSC→rank behavior instead of letting a bare enum retarget it.
 */
export function withResolvedBidOrderingAuthority(
  policy: FrozenLiveBidPolicy,
  authority: FrozenBidOrderingAuthority | undefined,
): FrozenLiveBidPolicy {
  const { orderingAuthority: _unverifiedAuthority, ...withoutAuthority } = policy;
  return FrozenLiveBidPolicySchema.parse({
    ...withoutAuthority,
    ...(authority === undefined ? {} : { orderingAuthority: authority }),
  });
}
