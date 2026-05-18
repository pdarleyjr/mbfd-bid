import { describe, expect, it } from 'vitest';
import { nonProbationarySatisfied } from '../../src/criteria/non-probationary.js';
import type { Member } from '../../src/types.js';

const member = (isProbationary: boolean): Member => ({
  employeeId: '1',
  firstName: 'A',
  lastName: 'B',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary,
  credentials: [],
});

describe('nonProbationarySatisfied', () => {
  it('non-probationary member satisfies', () => {
    expect(nonProbationarySatisfied(member(false)).satisfied).toBe(true);
  });

  it('probationary member fails', () => {
    const r = nonProbationarySatisfied(member(true));
    expect(r.satisfied).toBe(false);
    expect(r.code).toBe('PROBATIONARY_RESTRICTED');
  });
});
