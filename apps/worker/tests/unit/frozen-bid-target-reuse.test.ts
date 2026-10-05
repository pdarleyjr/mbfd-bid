import { BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  type FrozenSessionBidPolicy,
  evaluateRuleBookCoverage,
  resolveFrozenSessionBidTargetFromPolicy,
} from '../../src/lib/bid-policy.js';

function policy(): Extract<FrozenSessionBidPolicy, { ok: true }> {
  const material = {
    v: 1,
    positions: [
      {
        id: 'SYNTHETIC-OPEN',
        templateVersion: 'synthetic-reuse',
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: false,
        shift: 'A',
        station: '1',
        unit: 'Synthetic Engine',
        rankRequired: 'FF',
        positionName: 'Synthetic firefighter',
      },
      {
        id: 'SYNTHETIC-CLOSED',
        templateVersion: 'synthetic-reuse',
        bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        isExcludedFromCount: false,
        shift: 'A',
        station: '1',
        unit: 'Synthetic Engine',
        rankRequired: 'DC',
        positionName: 'Synthetic assigned chief',
      },
    ],
    rules: [
      {
        ruleBookVersion: 'synthetic-reuse',
        positionId: 'SYNTHETIC-OPEN',
        templateVersion: 'synthetic-reuse',
        requiredCriteriaJson: '{"rank":["FF"],"credentials":["Synthetic required"],"custom":[]}',
        pointsPreferenceJson: '{"max":0,"items":[]}',
        tieBreakChainJson: '["rsc_seniority"]',
      },
    ],
  };
  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: 'synthetic-reuse',
    ruleBookRevision: 0,
    positionTemplateVersion: 'synthetic-reuse',
    configurationRevision: 1,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
    },
    credentialEvaluationOn: '2027-01-01',
    capturedAtMs: 1,
    members: [
      {
        memberId: 10001,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: 1,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
      },
      {
        memberId: 10002,
        pool: 'EXCLUDED',
        rscSeniority: 2,
        rankSeniority: 2,
        exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
        authoritativeAssignmentId: null,
        rank: 'DC',
        isProbationary: false,
        credentialNames: [],
      },
    ],
    ruleBookMaterial: material,
  });
  if (snapshot.v !== 3) throw new Error('Synthetic material must be V3');
  const coverage = evaluateRuleBookCoverage({
    ruleBookVersion: snapshot.ruleBookVersion,
    rules: snapshot.ruleBookMaterial.rules,
    positions: snapshot.ruleBookMaterial.positions,
  });
  if (!coverage.valid) throw new Error('Synthetic rule book must be valid');
  return { ok: true, snapshot, coverage };
}

describe('frozen target resolution within a validated command', () => {
  it.each([
    'session_policy_snapshot_missing',
    'session_policy_snapshot_invalid',
    'session_policy_snapshot_material_missing',
    'session_rule_book_invalid',
    'session_rule_book_revision_changed',
    'session_policy_snapshot_revision_missing',
  ] as const)('retains the authenticated failure %s', (code) => {
    const failed = { ok: false, code } as const;
    expect(
      resolveFrozenSessionBidTargetFromPolicy(failed, {
        memberId: 10001,
        positionId: 'SYNTHETIC-OPEN',
      }),
    ).toBe(failed);
  });

  it('keeps membership checks even when a valid rule exists', () => {
    expect(
      resolveFrozenSessionBidTargetFromPolicy(policy(), {
        memberId: 19999,
        positionId: 'SYNTHETIC-OPEN',
      }),
    ).toEqual({ ok: false, code: 'member_not_in_bid_pool' });
  });

  it('retains the precise exclusion reason before resolving a seat', () => {
    expect(
      resolveFrozenSessionBidTargetFromPolicy(policy(), {
        memberId: 10002,
        positionId: 'SYNTHETIC-OPEN',
      }),
    ).toEqual({
      ok: false,
      code: 'member_excluded_from_bid_pool',
      exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
    });
  });

  it.each(['SYNTHETIC-CLOSED', 'SYNTHETIC-UNKNOWN'])('keeps %s outside biddable rules', (id) => {
    expect(
      resolveFrozenSessionBidTargetFromPolicy(policy(), { memberId: 10001, positionId: id }),
    ).toEqual({ ok: false, code: 'position_not_biddable' });
  });

  it('returns the exact authenticated member and rule for subsequent eligibility checks', () => {
    const frozen = policy();
    const before = JSON.stringify(frozen);
    const target = resolveFrozenSessionBidTargetFromPolicy(frozen, {
      memberId: 10001,
      positionId: 'SYNTHETIC-OPEN',
    });
    expect(target.ok).toBe(true);
    if (!target.ok) throw new Error('Synthetic open target expected');
    expect(target.snapshot).toBe(frozen.snapshot);
    expect(target.coverage).toBe(frozen.coverage);
    expect(target.member).toBe(frozen.snapshot.members[0]);
    expect(target.rule).toBe(frozen.coverage.rules[0]);
    // Target lookup does not certify the member. The command's qualification
    // or acknowledged override checks still receive the unsatisfied rule.
    expect(target.member.credentialNames).toEqual([]);
    expect(target.rule.requiredCriteria.credentials).toEqual(['Synthetic required']);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('does not reuse material across independent calls with the same member and seat IDs', () => {
    const previous = policy();
    const next = policy();
    const nextMember = next.snapshot.members[0];
    if (!nextMember) throw new Error('Synthetic member expected');
    nextMember.credentialNames = ['Synthetic newly reviewed'];
    const first = resolveFrozenSessionBidTargetFromPolicy(previous, {
      memberId: 10001,
      positionId: 'SYNTHETIC-OPEN',
    });
    const second = resolveFrozenSessionBidTargetFromPolicy(next, {
      memberId: 10001,
      positionId: 'SYNTHETIC-OPEN',
    });
    if (!first.ok || !second.ok) throw new Error('Synthetic open targets expected');
    expect(first.member.credentialNames).toEqual([]);
    expect(second.member.credentialNames).toEqual(['Synthetic newly reviewed']);
    expect(second.snapshot).toBe(next.snapshot);
    expect(second.snapshot).not.toBe(first.snapshot);
  });
});
