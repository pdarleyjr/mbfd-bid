import type { EligibilityResult, TieBreakKey } from './types.js';

export interface ComparableResult extends EligibilityResult {
  rscSeniority: number;
  rankSeniority: number;
}

function comparisonValues(a: ComparableResult, b: ComparableResult, key: TieBreakKey) {
  switch (key) {
    case 'points':
      return { left: a.points, right: b.points, direction: 'HIGHER_FIRST' as const };
    case 'so_points':
      return { left: a.soPoints, right: b.soPoints, direction: 'HIGHER_FIRST' as const };
    case 'mo_points':
      return { left: a.moPoints, right: b.moPoints, direction: 'HIGHER_FIRST' as const };
    case 'rsc_seniority':
      return { left: a.rscSeniority, right: b.rscSeniority, direction: 'LOWER_FIRST' as const };
    case 'rank_seniority':
      return { left: a.rankSeniority, right: b.rankSeniority, direction: 'LOWER_FIRST' as const };
  }
}

export type TieBreakStep = ReturnType<typeof comparisonValues> & {
  key: TieBreakKey;
  result: -1 | 0 | 1;
};

function compareUsingChain(
  a: ComparableResult,
  b: ComparableResult,
  tieBreakChain: TieBreakKey[],
  visit?: (step: TieBreakStep) => void,
): -1 | 0 | 1 {
  for (const key of tieBreakChain) {
    const values = comparisonValues(a, b, key);
    const diff =
      values.direction === 'HIGHER_FIRST' ? values.right - values.left : values.left - values.right;
    const result = diff < 0 ? -1 : diff > 0 ? 1 : 0;
    visit?.({ key, ...values, result });
    if (result !== 0) return result;
  }
  return 0;
}

export function compare(
  a: ComparableResult,
  b: ComparableResult,
  tieBreakChain: TieBreakKey[],
): -1 | 0 | 1 {
  return compareUsingChain(a, b, tieBreakChain);
}

/** Visits the exact comparator steps through the first decision. Ties stay ties. */
export function compareWithTrace(
  a: ComparableResult,
  b: ComparableResult,
  tieBreakChain: TieBreakKey[],
) {
  const steps: TieBreakStep[] = [];
  const result = compareUsingChain(a, b, tieBreakChain, (step) => steps.push(step));
  return { result, steps };
}

export function sortByTieBreak(
  results: ComparableResult[],
  tieBreakChain: TieBreakKey[],
): ComparableResult[] {
  return [...results].sort((a, b) => compare(a, b, tieBreakChain));
}
