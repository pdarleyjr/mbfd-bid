import { describe, expect, it, vi } from 'vitest';
import { evaluateEligibilityForSession } from '../../src/lib/session-loader.js';

const fakeMember = {
  id: 17,
  employeeId: '99999',
  firstName: 'Test',
  lastName: 'User',
  rank: 'FF' as const,
  rscSeniority: 10,
  rankSeniority: 5,
  isProbationary: false,
};
const fakeRule = {
  positionId: 'A101',
  ruleBookVersion: '2026.1',
  requiredCriteria: { rank: ['FF' as const], credentials: [], custom: [] },
  pointsPreference: { max: 0, items: [] },
  tieBreakChain: ['points' as const, 'rsc_seniority' as const, 'rank_seniority' as const],
};

function makeFakeDb(opts: { member?: typeof fakeMember | null; rule?: typeof fakeRule | null }) {
  return {
    loadMemberWithCredentials: vi.fn(async () => opts.member ?? null),
    loadPositionRule: vi.fn(async () => opts.rule ?? null),
  };
}

describe('evaluateEligibilityForSession (Plan 04 Task 6)', () => {
  it('returns eligible=true when rules and rank match', async () => {
    const db = makeFakeDb({ member: fakeMember, rule: fakeRule });
    const r = await evaluateEligibilityForSession(db, {
      ruleBookVersion: '2026.1',
      memberId: 17,
      positionId: 'A101',
    });
    expect(r.eligible).toBe(true);
  });

  it('returns eligible=false when member not found', async () => {
    const db = makeFakeDb({ member: null, rule: fakeRule });
    const r = await evaluateEligibilityForSession(db, {
      ruleBookVersion: '2026.1',
      memberId: 17,
      positionId: 'A101',
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((rs) => rs.code === 'MEMBER_NOT_FOUND')).toBe(true);
  });

  it('returns eligible=false when rule not found', async () => {
    const db = makeFakeDb({ member: fakeMember, rule: null });
    const r = await evaluateEligibilityForSession(db, {
      ruleBookVersion: '2026.1',
      memberId: 17,
      positionId: 'A101',
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((rs) => rs.code === 'RULE_NOT_FOUND')).toBe(true);
  });
});
