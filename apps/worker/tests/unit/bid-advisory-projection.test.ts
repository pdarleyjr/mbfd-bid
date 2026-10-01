import { describe, expect, it } from 'vitest';
import {
  type AuthoritativeBidAdvisoryProjectionInput,
  projectAuthoritativeBidAdvisory,
} from '../../src/lib/bid-advisory-projection.js';
import { evaluateRuleBookCoverage } from '../../src/lib/bid-policy.js';

describe('annual advisory member count', () => {
  it('counts a repeated annual candidate once and removes an awarded member from every stage', () => {
    const input: AuthoritativeBidAdvisoryProjectionInput = {
      sessionId: 'synthetic-annual-advisory',
      sequence: 1,
      phase: 'position_bid',
      isMock: true,
      frozenAt: null,
      currentBidderId: null,
      currentBidder: null,
      onDeck: [],
      bidOrder: [
        { ordinal: 1, memberId: 10, pool: 'OFC' },
        { ordinal: 2, memberId: 20, pool: 'FF' },
        { ordinal: 3, memberId: 10, pool: 'OFC' },
      ],
      fills: {},
      aDay: null,
      live: null,
      annual: null,
      memberNames: {},
      frozenPolicy: {
        ok: true,
        coverage: evaluateRuleBookCoverage({
          ruleBookVersion: 'synthetic',
          rules: [],
          positions: [],
        }),
        snapshot: {
          v: 3,
          ruleBookVersion: 'synthetic',
          ruleBookRevision: 0,
          positionTemplateVersion: 'synthetic',
          configurationRevision: 0,
          settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
          capturedAtMs: 1,
          members: [],
          ruleBookMaterial: { v: 1, rules: [], positions: [] },
        },
      },
    };
    const orderCard = (value: AuthoritativeBidAdvisoryProjectionInput) =>
      projectAuthoritativeBidAdvisory(value).cards.find((card) => card.kind === 'candidate_order');
    expect(orderCard(input)?.summary).toContain('2 members remain');
    expect(
      orderCard({ ...input, fills: { A101: { memberId: 10, filledAtMs: 1 } } })?.summary,
    ).toContain('1 member remains');
  });
});
