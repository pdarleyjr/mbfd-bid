import { describe, expect, it } from 'vitest';

import { evaluateRuleBookCoverage } from '../../src/lib/bid-policy.js';

const VALID_RULE_JSON = {
  requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
  pointsPreferenceJson: '{"max":0,"items":[]}',
  tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
};

describe('bid position participation policy', () => {
  it('treats administratively assigned Division Chief staffing positions as outside the rule-book opportunity set', () => {
    const coverage = evaluateRuleBookCoverage({
      ruleBookVersion: '2026.2',
      rules: [
        {
          id: 1,
          ruleBookVersion: '2026.2',
          positionId: 'A101',
          templateVersion: '2026.1',
          ...VALID_RULE_JSON,
        },
      ],
      positions: [
        { id: 'A101', templateVersion: '2026.1', bidParticipation: 'BIDDABLE' },
        {
          id: 'A211',
          templateVersion: '2026.1',
          bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        },
        {
          id: 'B211',
          templateVersion: '2026.1',
          bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        },
        {
          id: 'C211',
          templateVersion: '2026.1',
          bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        },
      ],
    });

    expect(coverage.valid).toBe(true);
    expect(coverage.expectedBiddablePositionIds).toEqual(['A101']);
    expect(coverage.missingBiddablePositionIds).toEqual([]);
    expect(coverage.nonBiddablePositionIds).toEqual([]);
    expect(coverage.invalidPositionIds).toEqual([]);
    expect(coverage.duplicatePositionIds).toEqual([]);
  });

  it('rejects a rule for an administratively assigned position even when its JSON is otherwise valid', () => {
    const coverage = evaluateRuleBookCoverage({
      ruleBookVersion: '2026.2',
      rules: [
        {
          id: 1,
          ruleBookVersion: '2026.2',
          positionId: 'A101',
          templateVersion: '2026.1',
          ...VALID_RULE_JSON,
        },
        {
          id: 2,
          ruleBookVersion: '2026.2',
          positionId: 'A211',
          templateVersion: '2026.1',
          ...VALID_RULE_JSON,
        },
      ],
      positions: [
        { id: 'A101', templateVersion: '2026.1', bidParticipation: 'BIDDABLE' },
        {
          id: 'A211',
          templateVersion: '2026.1',
          bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        },
      ],
    });

    expect(coverage.valid).toBe(false);
    expect(coverage.nonBiddablePositionIds).toEqual(['A211']);
  });

  it('does not turn an administratively assigned vacant slot into an opportunity', () => {
    const coverage = evaluateRuleBookCoverage({
      ruleBookVersion: '2026.2',
      rules: [
        {
          id: 1,
          ruleBookVersion: '2026.2',
          positionId: 'A101',
          templateVersion: '2026.1',
          ...VALID_RULE_JSON,
        },
      ],
      positions: [
        { id: 'A101', templateVersion: '2026.1', bidParticipation: 'BIDDABLE' },
        {
          id: 'A211',
          templateVersion: '2026.1',
          bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        },
      ],
    });

    expect(coverage.expectedBiddablePositionIds).not.toContain('A211');
    expect(coverage.validRulePositionIds).not.toContain('A211');
  });
});
