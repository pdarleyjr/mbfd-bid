import type { EligibilityResult, TieBreakKey } from './types.js';

export interface ComparableResult extends EligibilityResult {
  rscSeniority: number;
  rankSeniority: number;
}

export function compare(
  a: ComparableResult,
  b: ComparableResult,
  tieBreakChain: TieBreakKey[],
): -1 | 0 | 1 {
  for (const key of tieBreakChain) {
    let diff: number;

    switch (key) {
      case 'points':
        diff = b.points - a.points;
        break;
      case 'so_points':
        diff = b.soPoints - a.soPoints;
        break;
      case 'mo_points':
        diff = b.moPoints - a.moPoints;
        break;
      case 'rsc_seniority':
        diff = a.rscSeniority - b.rscSeniority;
        break;
      case 'rank_seniority':
        diff = a.rankSeniority - b.rankSeniority;
        break;
    }

    if (diff < 0) {
      return -1;
    }
    if (diff > 0) {
      return 1;
    }
  }
  return 0;
}

export function sortByTieBreak(
  results: ComparableResult[],
  tieBreakChain: TieBreakKey[],
): ComparableResult[] {
  return [...results].sort((a, b) => compare(a, b, tieBreakChain));
}
