import type { BidDefinitionSourceDecision, BidOrderingAuthorityRequest } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { resolveFrozenBidOrderingAuthority } from '../../src/lib/bid-ordering-authority.js';

const rankComparator: BidOrderingAuthorityRequest['comparator'] = [
  { key: 'RANK_SENIORITY', direction: 'ASC' },
];
const rscComparator: BidOrderingAuthorityRequest['comparator'] = [
  { key: 'RSC_SENIORITY', direction: 'ASC' },
];

function request(
  comparator: BidOrderingAuthorityRequest['comparator'] = rankComparator,
): BidOrderingAuthorityRequest {
  return {
    v: 1,
    sourceDecisionId: 'annual-ordering-governing-decision',
    comparator,
  };
}

function resolvedDecision(
  comparator: BidOrderingAuthorityRequest['comparator'] = rankComparator,
): BidDefinitionSourceDecision {
  return {
    issueId: 'annual-ordering-governing-decision',
    title: 'Synthetic annual ordering authority',
    question: 'Which seniority comparator governs the synthetic annual Bid order?',
    area: 'annual-policy',
    status: 'RESOLVED',
    decision: 'Use the reviewed synthetic comparator retained in the typed resolution.',
    sourceRef: 'Synthetic labor and annual-policy evidence reference.',
    effectiveOn: '2027-01-01',
    resolution: {
      v: 1,
      kind: 'BID_ORDERING_COMPARATOR',
      comparator,
    },
  };
}

describe('frozen Bid ordering authority', () => {
  it('freezes a comparator only from the exact resolved annual-policy decision identity', () => {
    expect(
      resolveFrozenBidOrderingAuthority({
        request: request(),
        sourceDecisions: [resolvedDecision()],
      }),
    ).toEqual({
      ok: true,
      authority: {
        v: 1,
        comparator: rankComparator,
        sourceDecision: {
          issueId: 'annual-ordering-governing-decision',
          effectiveOn: '2027-01-01',
        },
      },
    });
  });

  it.each([
    {
      name: 'no authority request',
      input: { request: undefined, sourceDecisions: [resolvedDecision()] },
      code: 'ordering_authority_unconfigured',
    },
    {
      name: 'a free-form source reference without typed comparator resolution',
      input: {
        request: request(),
        sourceDecisions: [
          {
            ...resolvedDecision(),
            resolution: undefined,
            sourceRef: 'Rank seniority according to an unstructured note.',
          },
        ],
      },
      code: 'ordering_authority_source_decision_unresolved',
    },
    {
      name: 'an open source decision',
      input: {
        request: request(),
        sourceDecisions: [{ ...resolvedDecision(), status: 'OPEN' }],
      },
      code: 'ordering_authority_source_decision_unresolved',
    },
    {
      name: 'a resolved decision that selects RSC rather than the requested rank comparator',
      input: { request: request(), sourceDecisions: [resolvedDecision(rscComparator)] },
      code: 'ordering_authority_comparator_mismatch',
    },
  ] as const)('fails closed for $name', ({ input, code }) => {
    expect(resolveFrozenBidOrderingAuthority(input)).toEqual({ ok: false, code });
  });
});
