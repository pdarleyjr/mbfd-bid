import { describe, expect, it } from 'vitest';
import { rankSatisfied } from '../../src/criteria/rank.js';
import type { Member } from '../../src/types.js';

const baseMember = (rank: Member['rank']): Member => ({
  employeeId: '99999',
  firstName: 'Test',
  lastName: 'User',
  rank,
  rscSeniority: 50,
  rankSeniority: 10,
  isProbationary: false,
  credentials: [],
});

describe('rankSatisfied', () => {
  it('FF satisfies FF-required position', () => {
    const r = rankSatisfied(baseMember('FF'), ['FF']);
    expect(r.satisfied).toBe(true);
    expect(r.code).toBe('RANK_OK');
  });

  it('LT satisfies LT-required position', () => {
    const r = rankSatisfied(baseMember('LT'), ['LT']);
    expect(r.satisfied).toBe(true);
  });

  it('FF fails LT-required position', () => {
    const r = rankSatisfied(baseMember('FF'), ['LT']);
    expect(r.satisfied).toBe(false);
    expect(r.code).toBe('RANK_REQUIRED');
    expect(r.label).toMatch(/Lieutenant/);
  });

  it('CPT satisfies CPT-required position', () => {
    expect(rankSatisfied(baseMember('CPT'), ['CPT']).satisfied).toBe(true);
  });

  it('DC fails CPT-required position (no upward substitution)', () => {
    expect(rankSatisfied(baseMember('DC'), ['CPT']).satisfied).toBe(false);
  });

  it('multiple allowed ranks — CPT satisfies [FF, LT, CPT]', () => {
    expect(rankSatisfied(baseMember('CPT'), ['FF', 'LT', 'CPT']).satisfied).toBe(true);
  });
});
