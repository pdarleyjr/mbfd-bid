import { describe, expect, it } from 'vitest';
import { paramedicSatisfied } from '../../src/criteria/paramedic.js';
import type { Member } from '../../src/types.js';

const withCreds = (names: string[]): Member => ({
  employeeId: '1',
  firstName: 'A',
  lastName: 'B',
  rank: 'FF',
  rscSeniority: 1,
  rankSeniority: 1,
  isProbationary: false,
  credentials: names.map((name) => ({ name })),
});

describe('paramedicSatisfied', () => {
  it('member with Paramedic cert satisfies', () => {
    const r = paramedicSatisfied(withCreds(['Paramedic']));
    expect(r.satisfied).toBe(true);
    expect(r.code).toBe('PARAMEDIC_OK');
  });

  it('member without Paramedic cert fails', () => {
    const r = paramedicSatisfied(withCreds(['EMT-Basic']));
    expect(r.satisfied).toBe(false);
    expect(r.code).toBe('PARAMEDIC_REQUIRED');
  });
});
