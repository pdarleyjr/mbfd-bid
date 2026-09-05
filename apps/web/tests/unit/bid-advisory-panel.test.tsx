import type { BidAdvisoryBundle } from '@mbfd/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BidAdvisoryPanel } from '../../app/admin/bid/_components/BidAdvisoryPanel';

const advisory: BidAdvisoryBundle = {
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
    {
      kind: 'position_options',
      severity: 'attention',
      title: 'Position options',
      summary: "2 unfilled positions satisfy the current bidder's frozen eligibility rules.",
      sources: ['selection_result', 'eligibility_engine', 'frozen_policy_snapshot'],
    },
  ],
};

describe('BidAdvisoryPanel', () => {
  it('renders concise source-labelled explanations with no input or mutation controls', () => {
    const html = renderToString(<BidAdvisoryPanel advisory={advisory} />);

    expect(html).toContain('BID Advisory');
    expect(html).toContain('Authoritative state · sequence 12');
    expect(html).toContain('Position bidding is active at sequence 12.');
    expect(html).toContain('Frozen eligibility rules');
    expect(html).not.toMatch(/<(?:form|input|textarea|button)\b/i);
    expect(html).not.toMatch(/provider|model|prompt|fallback/i);
  });
});
