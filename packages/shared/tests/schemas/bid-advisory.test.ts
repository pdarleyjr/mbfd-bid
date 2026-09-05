import { describe, expect, it } from 'vitest';

import { BidAdvisoryBundleSchema } from '../../src/schemas/bid-advisory.js';

describe('BidAdvisoryBundleSchema', () => {
  const valid = {
    v: 1,
    determinationSource: 'authoritative_bid_state',
    sessionId: 'session-1',
    sequence: 12,
    ruleBookVersion: '2027.3',
    positionTemplateVersion: '2027.2',
    configurationRevision: 4,
    cards: [
      {
        kind: 'bid_state',
        severity: 'ready',
        title: 'Bid state',
        summary: 'Position bidding is active at sequence 12.',
        sources: ['canonical_session_state', 'frozen_policy_snapshot'],
      },
    ],
  } as const;

  it('accepts a versioned, source-labelled deterministic advisory bundle', () => {
    expect(BidAdvisoryBundleSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unrecognized determination source or evidence source', () => {
    expect(() =>
      BidAdvisoryBundleSchema.parse({ ...valid, determinationSource: 'supplied_facts' }),
    ).toThrow();
    expect(() =>
      BidAdvisoryBundleSchema.parse({
        ...valid,
        cards: [{ ...valid.cards[0], sources: ['prompt'] }],
      }),
    ).toThrow();
  });
});
