import { describe, expect, it } from 'vitest';
import { evaluateEligibility, evaluateEligibilityWithTrace } from '../src/evaluate.js';
import { scoreReferenceForPositions } from '../src/score-reference.js';
import { compareWithTrace, sortByTieBreak } from '../src/tie-break.js';
import type { Member, PositionRule, ScoreReferenceEvidence } from '../src/types.js';

const source = (patch: Partial<ScoreReferenceEvidence> = {}): ScoreReferenceEvidence => ({
  v: 1,
  listId: 'SYNTHETIC_FINAL',
  positionIds: ['P1'],
  points: 12,
  soPoints: 6,
  moPoints: 0,
  sourceName: 'Synthetic reviewed ranking.pdf',
  sourceSha256: 'a'.repeat(64),
  sourceLocation: { page: 1, textLine: 10 },
  literalTotal: 12,
  printedBidOrder: 15,
  sourcePriority: 1,
  ...patch,
});
const member: Member = {
  employeeId: 'synthetic-1',
  firstName: 'Synthetic',
  lastName: 'Member',
  rank: 'LT',
  rscSeniority: 20,
  rankSeniority: 30,
  isProbationary: false,
  credentials: [{ name: 'Required Qualification' }],
};
const rule: PositionRule = {
  positionId: 'P1',
  ruleBookVersion: 'synthetic-v1',
  requiredCriteria: { rank: ['LT'], credentials: ['Required Qualification'], custom: [] },
  pointsPreference: { max: 2, items: [] },
  tieBreakChain: ['points', 'rank_seniority'],
};
const comparable = (reference: ScoreReferenceEvidence, seniority = 30) => ({
  ...evaluateEligibility({ ...member, scoreReferenceEvidence: [reference] }, rule),
  rscSeniority: seniority,
  rankSeniority: seniority,
});

describe('reviewed numeric source ranking', () => {
  it('uses exact-position reviewed channels and provides provenance in the scoring trace', () => {
    const traced = evaluateEligibilityWithTrace(
      { ...member, scoreReferenceEvidence: [source()] },
      rule,
    );
    expect(traced.result).toMatchObject({ eligible: true, points: 12, soPoints: 6, moPoints: 0 });
    expect(traced.channels.so).toMatchObject({ total: 6 });
    expect(traced.result.breakdown.itemized[0]?.reason).toContain('page 1, line 10');
    expect(traced.result.breakdown.itemized[0]?.reason).toContain(
      'qualification validity unchanged',
    );
    expect(traced.result.scoreReferencePriority).toEqual({
      listId: 'SYNTHETIC_FINAL',
      sourceSha256: 'a'.repeat(64),
      priority: 1,
    });
  });

  it('does not grant a missing qualification, wrong rank, or expired qualification', () => {
    const reference = { scoreReferenceEvidence: [source({ points: 99 })] };
    for (const candidate of [
      { ...member, credentials: [] },
      { ...member, rank: 'FF' as const },
      {
        ...member,
        credentials: [
          {
            name: 'Required Qualification',
            status: 'expired' as const,
            effectiveOn: '2020-01-01',
            expiresOn: '2025-12-31',
          },
        ],
        scoringEvidence: { evaluationOn: '2026-10-05', completedCredentialNames: [] },
      },
    ]) {
      expect(evaluateEligibility({ ...candidate, ...reference }, rule)).toMatchObject({
        eligible: false,
        points: 0,
        soPoints: 0,
        moPoints: 0,
      });
    }
  });

  it('keeps absent references and references to other positions byte-identical', () => {
    const original = JSON.stringify(evaluateEligibility(member, rule));
    expect(
      JSON.stringify(evaluateEligibility({ ...member, scoreReferenceEvidence: [] }, rule)),
    ).toBe(original);
    expect(
      JSON.stringify(
        evaluateEligibility(
          { ...member, scoreReferenceEvidence: [source({ positionIds: ['P2'] })] },
          rule,
        ),
      ),
    ).toBe(original);
  });

  it('uses physical source priority ahead of points and literal printed ordinals', () => {
    const first = comparable(source({ sourcePriority: 1, printedBidOrder: 20, points: 1 }), 99);
    const second = comparable(source({ sourcePriority: 2, printedBidOrder: 1, points: 20 }), 1);
    expect(sortByTieBreak([second, first], rule.tieBreakChain)).toEqual([first, second]);
    expect(compareWithTrace(first, second, rule.tieBreakChain)).toEqual({
      result: -1,
      steps: [
        {
          key: 'source_priority',
          listId: 'SYNTHETIC_FINAL',
          sourceSha256: 'a'.repeat(64),
          left: 1,
          right: 2,
          direction: 'LOWER_FIRST',
          result: -1,
        },
      ],
    });
  });

  it('rejects ambiguous source cohorts and duplicate source priorities', () => {
    const first = comparable(source());
    expect(() =>
      sortByTieBreak(
        [first, comparable(source({ listId: 'OTHER_LIST', sourcePriority: 2 }))],
        rule.tieBreakChain,
      ),
    ).toThrow('SCORE_REFERENCE_COHORT_MISMATCH');
    expect(() =>
      sortByTieBreak(
        [first, comparable(source({ sourceSha256: 'b'.repeat(64), sourcePriority: 2 }))],
        rule.tieBreakChain,
      ),
    ).toThrow('SCORE_REFERENCE_COHORT_MISMATCH');
    expect(() => sortByTieBreak([first, comparable(source())], rule.tieBreakChain)).toThrow(
      'SCORE_REFERENCE_PRIORITY_AMBIGUOUS',
    );
  });

  it('falls back to the declared frozen chain when a cohort member has no reference', () => {
    const first = comparable(source({ points: 12 }));
    const second = {
      ...comparable(source({ sourcePriority: 2, points: 20 })),
      scoreReferencePriority: undefined,
    };
    expect(sortByTieBreak([first, second], rule.tieBreakChain)).toEqual([second, first]);
  });

  it('rejects overlapping, partial, or inconsistent complete specialty scopes', () => {
    expect(() => scoreReferenceForPositions([source(), source()], ['P1'])).toThrow(
      'SCORE_REFERENCE_SCOPE_AMBIGUOUS',
    );
    expect(() => scoreReferenceForPositions([source()], ['P1', 'P2'])).toThrow(
      'SCORE_REFERENCE_SCOPE_INCOMPLETE',
    );
    expect(() =>
      scoreReferenceForPositions(
        [source(), source({ positionIds: ['P2'], points: 11 })],
        ['P1', 'P2'],
      ),
    ).toThrow('SCORE_REFERENCE_SCOPE_INCONSISTENT');
    const complete = source({ positionIds: ['P1', 'P2'] });
    expect(scoreReferenceForPositions([complete], ['P1', 'P2'])).toBe(complete);
  });
});
