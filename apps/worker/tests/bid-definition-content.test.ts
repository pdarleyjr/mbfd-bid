import { readFileSync } from 'node:fs';
import { evaluateEligibility } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { canonicalBidDefinition, definitionRuleRows } from '../src/lib/bid-definition-content.js';
import { decodePositionRule } from '../src/lib/position-rule.js';

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required synthetic fixture entry absent');
  return value;
}

function definition() {
  return {
    v: 1,
    bidYear: 2027,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
    },
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: null,
    positions: ['seat-b', 'seat-a'].map((id) => ({
      id,
      shift: 'A',
      station: '7',
      division: 'Combat',
      unit: 'Engine 7',
      rankRequired: 'FF',
      positionName: 'Firefighter',
      isFloating: false,
      isVacantByDesign: false,
      isExcludedFromCount: false,
    })),
    rules: ['seat-b', 'seat-a'].map((positionId) => ({
      positionId,
      requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
      pointsPreferenceJson:
        '{"max":10,"items":[{"credential":"Synthetic qualification","points":5}]}',
      tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
      notes: null,
    })),
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  };
}

describe('immutable Bid semantic content', () => {
  it('canonicalizes object keys and true row sets without modifying caller input', () => {
    const original = definition();
    const bytes = JSON.stringify(original);
    const result = canonicalBidDefinition(original);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Valid synthetic definition rejected');
    const reordered = definition();
    reordered.positions.reverse();
    reordered.rules.reverse();
    for (const rule of reordered.rules) {
      rule.requiredCriteriaJson = '{ "custom": [], "credentials": [], "rank": ["FF"] }';
    }
    expect(canonicalBidDefinition(reordered)).toEqual(result);
    expect(result.content.positions.map((p) => p.id)).toEqual(['seat-a', 'seat-b']);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(canonicalBidDefinition(result.content)).toEqual(result);
  });

  it('does not erase ordered priority or capped scoring changes', () => {
    const baseline = canonicalBidDefinition(definition());
    const changed = definition();
    present(changed.rules[0]).tieBreakChainJson = '["rsc_seniority","points","rank_seniority"]';
    expect(canonicalBidDefinition(changed)).not.toEqual(baseline);
    const scores = definition();
    const items = [
      { credential: 'Synthetic qualification', points: 7 },
      { credential: 'Synthetic second qualification', points: 5 },
    ];
    present(scores.rules[0]).pointsPreferenceJson = JSON.stringify({ max: 10, items });
    const prior = canonicalBidDefinition(scores);
    present(scores.rules[0]).pointsPreferenceJson = JSON.stringify({
      max: 10,
      items: items.reverse(),
    });
    expect(canonicalBidDefinition(scores)).not.toEqual(prior);
  });

  it.each(['unknown-rule', 'duplicate-rule', 'orphan-rule', 'duplicate-position', 'unknown-field'])(
    'rejects %s',
    (kind) => {
      const candidate = definition();
      if (kind === 'unknown-rule')
        present(candidate.rules[0]).requiredCriteriaJson =
          '{"rank":["FF"],"credentials":[],"custom":[],"eval":"true"}';
      if (kind === 'duplicate-rule') candidate.rules.push({ ...present(candidate.rules[0]) });
      if (kind === 'orphan-rule') present(candidate.rules[0]).positionId = 'absent';
      if (kind === 'duplicate-position')
        candidate.positions.push({ ...present(candidate.positions[0]) });
      expect(
        canonicalBidDefinition(
          kind === 'unknown-field' ? { ...candidate, runState: {} } : candidate,
        ).ok,
      ).toBe(false);
    },
  );

  it('retains missing coverage as a visible readiness conflict, never adds a guessed rule', () => {
    const candidate = definition();
    candidate.rules.pop();
    const result = canonicalBidDefinition(candidate);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Structurally valid draft rejected');
    expect(result.coverage.valid).toBe(false);
    expect(result.coverage.missingBiddablePositionIds).toEqual(['seat-a']);
    expect(result.content.rules).toHaveLength(1);
  });

  it('includes source language and provenance, while excluding minted backing aliases', () => {
    const candidate = definition();
    const result = canonicalBidDefinition(candidate);
    const notes = canonicalBidDefinition({
      ...candidate,
      notes: { bid: 'Reviewed instruction', positions: null },
    });
    expect(notes).not.toEqual(result);
    if (!result.ok) throw new Error('Valid synthetic definition rejected');
    const rows = definitionRuleRows(result.content, '2027.18', '2027.900');
    expect(
      rows.every((r) => r.ruleBookVersion === '2027.18' && r.templateVersion === '2027.900'),
    ).toBe(true);
    expect(result.serialized).not.toContain('2027.18');
    expect(result.serialized).not.toContain('2027.900');
  });

  it('retains executable meaning for every committed 2026 seed rule after canonical materialization', () => {
    const rows = JSON.parse(
      readFileSync(new URL('../seed/fixtures/2026_rules.json', import.meta.url), 'utf8'),
    ) as Array<{
      positionId: string;
      ruleBookVersion: string;
      requiredCriteria: unknown;
      pointsPreference: unknown;
      tieBreakChain: unknown;
    }>;
    const rejected: string[] = [];
    for (const row of rows) {
      const original = {
        ...row,
        requiredCriteriaJson: JSON.stringify(row.requiredCriteria),
        pointsPreferenceJson: JSON.stringify(row.pointsPreference),
        tieBreakChainJson: JSON.stringify(row.tieBreakChain),
      };
      const decoded = decodePositionRule(original);
      const candidate = definition();
      candidate.positions = [{ ...present(candidate.positions[0]), id: row.positionId }];
      candidate.rules = [
        {
          positionId: row.positionId,
          requiredCriteriaJson: original.requiredCriteriaJson,
          pointsPreferenceJson: original.pointsPreferenceJson,
          tieBreakChainJson: original.tieBreakChainJson,
          notes: null,
        },
      ];
      const material = canonicalBidDefinition(candidate);
      if (!decoded.ok) {
        rejected.push(row.positionId);
        expect(decoded.issues.map((issue) => issue.code)).toEqual(['unsupported_custom']);
        expect(material.ok).toBe(false);
        if (material.ok) throw new Error('Rejected legacy material was silently accepted');
        expect(material.issues.map((issue) => issue.code)).toEqual(['unsupported_custom']);
        continue;
      }
      expect(material.ok).toBe(true);
      if (!material.ok) throw new Error(`Canonical material rejected ${row.positionId}`);
      const roundtrip = decodePositionRule(
        definitionRuleRows(material.content, row.ruleBookVersion, '2027.900')[0],
      );
      expect(roundtrip).toEqual(decoded);
      if (!roundtrip.ok) throw new Error('Roundtrip failed');
      const evidence = {
        memberId: 1,
        employeeId: 'synthetic',
        firstName: 'Synthetic',
        lastName: 'Parity',
        rank: present(decoded.rule.requiredCriteria.rank[0]),
        rscSeniority: 1,
        rankSeniority: 1,
        isProbationary: false,
        credentials: decoded.rule.requiredCriteria.credentials.map((name) => ({ name })),
      };
      expect(evaluateEligibility(evidence, roundtrip.rule)).toEqual(
        evaluateEligibility(evidence, decoded.rule),
      );
    }
    expect(rows).toHaveLength(50);
    expect(rejected).toEqual(['A211', 'B211', 'C211']);
  });
});
