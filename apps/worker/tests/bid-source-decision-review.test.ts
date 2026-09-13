import { createHash } from 'node:crypto';
import type { BidDefinitionContent } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { canonicalBidDefinition } from '../src/lib/bid-definition-content.js';
import { bidSourceDecisionReviewIssues } from '../src/lib/bid-source-decision-review.js';

const boundaries = [
  ['title', 200],
  ['question', 3000],
  ['decision', 4000],
  ['sourceRef', 1000],
] as const;
type Decision = BidDefinitionContent['sourceDecisions'][number];
const resolved: Decision = {
  issueId: 'synthetic-source-boundary',
  title: 'Synthetic reviewed title',
  question: 'Which synthetic source controls?',
  area: 'annual-policy',
  status: 'RESOLVED',
  decision: 'Use the reviewed synthetic source interpretation.',
  sourceRef: 'Synthetic source document, section 4',
  effectiveOn: '2027-01-01',
};

describe('source decision review boundaries', () => {
  it.each(boundaries)('rejects %s above its existing source-review maximum', (field, maximum) => {
    const decision = { ...resolved, [field]: `  ${'x'.repeat(maximum + 1)}  ` };
    expect(bidSourceDecisionReviewIssues([decision])).toEqual([
      expect.objectContaining({
        path: ['sourceDecisions', 0, field],
        code: 'complete_source_decision_required',
      }),
    ]);
  });

  it.each(boundaries)(
    'accepts exact trimmed minimum and maximum for %s without normalizing recorded bytes',
    (field, maximum) => {
      for (const length of [4, maximum]) {
        const decision = Object.freeze({ ...resolved, [field]: ` \t${'x'.repeat(length)}\n ` });
        const decisions = Object.freeze([decision]);
        const bytes = JSON.stringify(decisions);
        expect(bidSourceDecisionReviewIssues(decisions)).toEqual([]);
        expect(JSON.stringify(decisions)).toBe(bytes);
        expect(decision[field]).toBe(` \t${'x'.repeat(length)}\n `);
      }
    },
  );

  it('reports the actual resolved record index while leaving incomplete OPEN content editable', () => {
    const decisions = [
      { status: 'OPEN' as const },
      { ...resolved, question: '' },
      resolved,
      { ...resolved, decision: '', sourceRef: '' },
    ];
    expect(bidSourceDecisionReviewIssues(decisions).map((issue) => issue.path)).toEqual([
      ['sourceDecisions', 1, 'question'],
      ['sourceDecisions', 3, 'decision'],
      ['sourceDecisions', 3, 'sourceRef'],
    ]);
  });

  it('keeps historical incomplete resolved source material canonical and byte-identifiable', () => {
    // Fixed serialized historical material is read evidence, not new admission authority.
    const historical =
      '{"authoring":null,"bidYear":2027,"notes":{"bid":null,"positions":null},"participation":[],"planning":null,"policy":null,"positions":[],"rules":[],"settings":null,"sourceDecisions":[{"area":"annual-policy","decision":" ","effectiveOn":"2027-01-01","issueId":"synthetic-historical-source","question":"","sourceRef":"","status":"RESOLVED","title":""}],"staffingBindings":[],"v":1}';
    const content = JSON.parse(historical) as BidDefinitionContent;
    const canonical = canonicalBidDefinition(content);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) throw new Error(JSON.stringify(canonical));
    expect(canonical.serialized).toBe(historical);
    expect(canonical.sha256).toBe(createHash('sha256').update(historical).digest('hex'));
    expect(canonical.content.sourceDecisions).toEqual(content.sourceDecisions);
    expect(bidSourceDecisionReviewIssues(canonical.content.sourceDecisions)).toHaveLength(4);
    expect(canonicalBidDefinition(canonical.content)).toEqual(canonical);
  });
});
