import { describe, expect, it } from 'vitest';
import {
  type ComparableResult,
  compare,
  compareWithTrace,
  sortByTieBreak,
} from '../../src/tie-break.js';

function candidate(timeInGrade: number, departmentService: number): ComparableResult {
  return {
    eligible: true,
    reasons: [],
    points: 0,
    soPoints: 0,
    moPoints: 0,
    breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
    rscSeniority: 900 - departmentService,
    rankSeniority: 900 - timeInGrade,
    bidOrdinalEvidence: {
      datasetId: 'synthetic-final-source',
      sourceSha256: 'a'.repeat(64),
      timeInGrade,
      departmentService,
    },
  };
}

describe('reviewed Bid ordinal tie-break channels', () => {
  it('uses separate reviewed channels rather than legacy seniority fields', () => {
    const a = candidate(1, 2);
    const b = candidate(2, 1);
    expect(compare(a, b, ['time_in_grade_bid_ordinal'])).toBe(-1);
    expect(compare(a, b, ['department_service_bid_ordinal'])).toBe(1);
    expect(compare(a, b, ['rank_seniority'])).toBe(1);
    expect(compare(a, b, ['rsc_seniority'])).toBe(-1);
    expect(compareWithTrace(a, b, ['time_in_grade_bid_ordinal'])).toEqual({
      result: -1,
      steps: [
        {
          key: 'time_in_grade_bid_ordinal',
          left: 1,
          right: 2,
          direction: 'LOWER_FIRST',
          result: -1,
        },
      ],
    });
  });
  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects missing or invalid required evidence %s, including a singleton',
    (value) => {
      const a = candidate(1, 1);
      if (value === undefined) a.bidOrdinalEvidence = undefined;
      else if (a.bidOrdinalEvidence) a.bidOrdinalEvidence.timeInGrade = value;
      expect(() => sortByTieBreak([a], ['time_in_grade_bid_ordinal'])).toThrow(
        'BID_ORDINAL_EVIDENCE_MISSING',
      );
      expect(() =>
        compare({ ...a, points: 99 }, candidate(2, 2), ['points', 'time_in_grade_bid_ordinal']),
      ).toThrow('BID_ORDINAL_EVIDENCE_MISSING');
    },
  );
  it('does not invent a tie-break or require new evidence for historical keys', () => {
    expect(compare(candidate(1, 1), candidate(1, 1), ['department_service_bid_ordinal'])).toBe(0);
    const historical = candidate(1, 1);
    historical.bidOrdinalEvidence = undefined;
    expect(compare(historical, { ...historical, points: 1 }, ['points', 'rsc_seniority'])).toBe(1);
  });
});
