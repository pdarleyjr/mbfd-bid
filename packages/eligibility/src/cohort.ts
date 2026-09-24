import { evaluateEligibility } from './evaluate.js';
import { compare, missingBidOrdinalKeys } from './tie-break.js';
import type {
  CohortDecision,
  EligibilityCohortResult,
  Member,
  PositionRule,
  TieBreakKey,
} from './types.js';

function component(
  member: Member,
  key: TieBreakKey,
  result: ReturnType<typeof evaluateEligibility>,
) {
  switch (key) {
    case 'points':
      return result.points;
    case 'so_points':
      return result.soPoints;
    case 'mo_points':
      return result.moPoints;
    case 'rsc_seniority':
      return member.rscSeniority;
    case 'rank_seniority':
      return member.rankSeniority;
    case 'time_in_grade_bid_ordinal':
      return member.bidOrdinalEvidence?.timeInGrade;
    case 'department_service_bid_ordinal':
      return member.bidOrdinalEvidence?.departmentService;
  }
}

/**
 * Canonical position-list evaluator. It is deliberately fail-closed: members
 * with missing ordering evidence or an unresolved policy tie are kept out of
 * the official ordered list and returned in a separate data-blocked section.
 */
export function evaluateEligibilityCohort(input: {
  members: readonly Member[];
  rule: PositionRule;
  asOf: string;
}): EligibilityCohortResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error('INVALID_AS_OF');
  const seen = new Set<string>();
  const decisions: CohortDecision[] = input.members.map((member) => {
    if (seen.has(member.employeeId)) throw new Error('AMBIGUOUS_MEMBER_IDENTITY');
    seen.add(member.employeeId);
    const evaluatedMember: Member = {
      ...member,
      scoringEvidence: {
        evaluationOn: input.asOf,
        completedCredentialNames: member.scoringEvidence?.completedCredentialNames ?? [],
      },
    };
    const result = evaluateEligibility(evaluatedMember, input.rule);
    const comparable = {
      ...result,
      rscSeniority: member.rscSeniority,
      rankSeniority: member.rankSeniority ?? Number.MAX_SAFE_INTEGER,
      bidOrdinalEvidence: member.bidOrdinalEvidence,
    };
    const missing = result.eligible
      ? missingBidOrdinalKeys(comparable, input.rule.tieBreakChain)
      : [];
    const dataBlockers = missing.map((key) => `Missing reviewed ordering evidence: ${key}`);
    if (
      result.eligible &&
      input.rule.tieBreakChain.includes('rank_seniority') &&
      member.rank !== 'FF' &&
      member.rankSeniority === undefined
    )
      dataBlockers.push('Missing time-in-grade seniority evidence');
    const orderingComponents = Object.fromEntries(
      input.rule.tieBreakChain.flatMap((key) => {
        const value = component(member, key, result);
        return value === undefined ? [] : [[key, value]];
      }),
    ) as Partial<Record<TieBreakKey, number>>;
    return { member, result, priority: null, orderingComponents, dataBlockers };
  });

  const excluded = decisions.filter((decision) => !decision.result.eligible);
  const initiallyRankable = decisions.filter(
    (decision) => decision.result.eligible && decision.dataBlockers.length === 0,
  );
  const comparable = (decision: CohortDecision) => ({
    ...decision.result,
    rscSeniority: decision.member.rscSeniority,
    rankSeniority: decision.member.rankSeniority ?? Number.MAX_SAFE_INTEGER,
    bidOrdinalEvidence: decision.member.bidOrdinalEvidence,
  });
  initiallyRankable.sort((left, right) =>
    compare(comparable(left), comparable(right), input.rule.tieBreakChain),
  );
  for (let index = 0; index < initiallyRankable.length; index++) {
    const current = initiallyRankable[index];
    if (!current) continue;
    const prior = initiallyRankable[index - 1];
    const next = initiallyRankable[index + 1];
    if (
      (prior && compare(comparable(prior), comparable(current), input.rule.tieBreakChain) === 0) ||
      (next && compare(comparable(current), comparable(next), input.rule.tieBreakChain) === 0)
    )
      current.dataBlockers.push('Policy ordering chain leaves this member tied');
  }
  const eligible = initiallyRankable.filter((decision) => decision.dataBlockers.length === 0);
  let priority = 0;
  let last: CohortDecision | undefined;
  for (const decision of eligible) {
    if (!last || compare(comparable(last), comparable(decision), input.rule.tieBreakChain) !== 0)
      priority += 1;
    decision.priority = priority;
    last = decision;
  }
  const dataBlocked = decisions.filter(
    (decision) => decision.result.eligible && decision.dataBlockers.length > 0,
  );
  return {
    positionId: input.rule.positionId,
    ruleBookVersion: input.rule.ruleBookVersion,
    asOf: input.asOf,
    eligible,
    excluded,
    dataBlocked,
  };
}
