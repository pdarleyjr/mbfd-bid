import {
  type EligibilityResult,
  type Member,
  type PositionRule,
  evaluateEligibility,
} from '@mbfd/eligibility';

export type MemberWithCreds = Omit<Member, 'credentials'> & {
  credentials?: Member['credentials'];
};

export interface SessionLoaderDb {
  loadMemberWithCredentials(memberId: number): Promise<MemberWithCreds | null>;
  loadPositionRule(ruleBookVersion: string, positionId: string): Promise<PositionRule | null>;
}

export async function evaluateEligibilityForSession(
  db: SessionLoaderDb,
  input: { ruleBookVersion: string; memberId: number; positionId: string },
): Promise<EligibilityResult> {
  const member = await db.loadMemberWithCredentials(input.memberId);
  if (!member) {
    return {
      eligible: false,
      reasons: [
        {
          code: 'MEMBER_NOT_FOUND',
          label: `Member ${input.memberId} not loaded`,
          satisfied: false,
        },
      ],
      points: 0,
      soPoints: 0,
      moPoints: 0,
      breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
    };
  }
  const rule = await db.loadPositionRule(input.ruleBookVersion, input.positionId);
  if (!rule) {
    return {
      eligible: false,
      reasons: [
        {
          code: 'RULE_NOT_FOUND',
          label: `No rule for position ${input.positionId} in ${input.ruleBookVersion}`,
          satisfied: false,
        },
      ],
      points: 0,
      soPoints: 0,
      moPoints: 0,
      breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
    };
  }
  const m: Member = { ...member, credentials: member.credentials ?? [] };
  return evaluateEligibility(m, rule);
}
