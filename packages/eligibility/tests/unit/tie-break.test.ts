import { describe, expect, it } from 'vitest';
import { compare } from '../../src/tie-break.js';
import type { EligibilityResult, TieBreakKey } from '../../src/types.js';

const result = (
  overrides: Partial<{
    points: number;
    soPoints: number;
    moPoints: number;
    rscSeniority: number;
    rankSeniority: number;
  }>,
): EligibilityResult & { rscSeniority: number; rankSeniority: number } => ({
  eligible: true,
  reasons: [],
  points: 0,
  soPoints: 0,
  moPoints: 0,
  breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
  rscSeniority: 50,
  rankSeniority: 10,
  ...overrides,
});

const chain: TieBreakKey[] = ['points', 'so_points', 'rsc_seniority', 'rank_seniority'];

describe('compare', () => {
  it('a has more points than b → a wins (-1)', () => {
    expect(compare(result({ points: 5 }), result({ points: 3 }), chain)).toBe(-1);
  });

  it('b has more points than a → b wins (1)', () => {
    expect(compare(result({ points: 2 }), result({ points: 8 }), chain)).toBe(1);
  });

  it('equal points, a has lower rsc_seniority → a wins (-1)', () => {
    expect(
      compare(
        result({ points: 5, rscSeniority: 10 }),
        result({ points: 5, rscSeniority: 20 }),
        chain,
      ),
    ).toBe(-1);
  });

  it('equal points, equal rsc_seniority, a has lower rank_seniority → a wins (-1)', () => {
    expect(
      compare(
        result({ points: 5, rscSeniority: 10, rankSeniority: 2 }),
        result({ points: 5, rscSeniority: 10, rankSeniority: 5 }),
        chain,
      ),
    ).toBe(-1);
  });

  it('completely equal → returns 0', () => {
    expect(
      compare(
        result({ points: 5, rscSeniority: 10, rankSeniority: 2 }),
        result({ points: 5, rscSeniority: 10, rankSeniority: 2 }),
        chain,
      ),
    ).toBe(0);
  });

  it('so_points key is used when chain includes it', () => {
    const soChain: TieBreakKey[] = ['points', 'so_points', 'rsc_seniority', 'rank_seniority'];
    const a = result({ points: 5, soPoints: 10, rscSeniority: 20 });
    const b = result({ points: 5, soPoints: 7, rscSeniority: 5 });
    expect(compare(a, b, soChain)).toBe(-1);
  });

  it('mo_points key is used when chain includes it', () => {
    const moChain: TieBreakKey[] = ['points', 'mo_points', 'rsc_seniority', 'rank_seniority'];
    const a = result({ points: 4, moPoints: 6, rscSeniority: 30 });
    const b = result({ points: 4, moPoints: 6, rscSeniority: 5 });
    expect(compare(a, b, moChain)).toBe(1);
  });

  it('stability: compare(a, b) === -compare(b, a) for unequal cases', () => {
    const a = result({ points: 7 });
    const b = result({ points: 3 });
    expect(compare(a, b, chain)).toBe(-compare(b, a, chain));
  });
});
