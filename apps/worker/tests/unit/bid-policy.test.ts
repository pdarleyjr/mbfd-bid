import { describe, expect, it } from 'vitest';

import { evaluateRuleBookCoverage } from '../../src/lib/bid-policy.js';

const VALID_RULE_JSON = {
  requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
  pointsPreferenceJson: '{"max":0,"items":[]}',
  tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
};

describe('bid position participation policy', () => {
  it('rejects a decoded rule whose required rank belongs to the former A213 role', () => {
    const coverage = evaluateRuleBookCoverage({
      ruleBookVersion: '2026.corrected',
      rules: [
        {
          ruleBookVersion: '2026.corrected',
          positionId: 'A213',
          templateVersion: '2026.corrected',
          requiredCriteriaJson: '{"rank":["CPT"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: VALID_RULE_JSON.pointsPreferenceJson,
          tieBreakChainJson: VALID_RULE_JSON.tieBreakChainJson,
        },
      ],
      positions: [
        {
          id: 'A213',
          templateVersion: '2026.corrected',
          bidParticipation: 'BIDDABLE',
          rankRequired: 'LT',
        },
      ],
    });
    expect(coverage.valid).toBe(false);
    expect(coverage.rankMismatchPositionIds).toEqual(['A213']);
  });

  it('blocks an executable rule with a credential placeholder absent from the approved catalog', () => {
    const coverage = evaluateRuleBookCoverage({
      ruleBookVersion: '2026.corrected',
      credentialCatalogNames: ['Firesafety Inspector I'],
      rules: [
        {
          ruleBookVersion: '2026.corrected',
          positionId: 'D102',
          templateVersion: '2026.corrected',
          requiredCriteriaJson:
            '{"rank":["FF"],"credentials":["Current FL Fire Inspector"],"custom":[]}',
          pointsPreferenceJson: VALID_RULE_JSON.pointsPreferenceJson,
          tieBreakChainJson: VALID_RULE_JSON.tieBreakChainJson,
        },
      ],
      positions: [
        {
          id: 'D102',
          templateVersion: '2026.corrected',
          bidParticipation: 'BIDDABLE',
          rankRequired: 'FF',
        },
      ],
    });
    expect(coverage.valid).toBe(false);
    expect(coverage.unresolvedCredentialReferences).toEqual(['D102:Current FL Fire Inspector']);
  });

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
