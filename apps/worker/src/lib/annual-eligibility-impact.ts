import { type Member, type PositionRule, compare, evaluateEligibility } from '@mbfd/eligibility';

export type ImpactMember = { memberId: number; evidence: Member };
export type ImpactScore = {
  eligible: boolean;
  points: number;
  soPoints: number;
  moPoints: number;
  priority: number | null;
  reasons: string[];
};
export type ImpactChange = {
  positionId: string;
  memberId: number;
  before: ImpactScore;
  after: ImpactScore;
};

function evaluateCohort(members: ImpactMember[], rule: PositionRule) {
  const evaluated = members.map((member) => ({
    memberId: member.memberId,
    ...evaluateEligibility(member.evidence, rule),
    rscSeniority: member.evidence.rscSeniority,
    rankSeniority: member.evidence.rankSeniority ?? Number.MAX_SAFE_INTEGER,
  }));
  const ranked = evaluated
    .filter((r) => r.eligible)
    .sort((a, b) => compare(a, b, rule.tieBreakChain));
  const priorities = new Map<number, number>();
  let priority = 1;
  for (let index = 0; index < ranked.length; index++) {
    const entry = ranked[index];
    const prior = ranked[index - 1];
    if (!entry) continue;
    if (prior && compare(prior, entry, rule.tieBreakChain) !== 0) priority = index + 1;
    priorities.set(entry.memberId, priority);
  }
  return new Map(
    evaluated.map((result) => [
      result.memberId,
      {
        eligible: result.eligible,
        points: result.points,
        soPoints: result.soPoints,
        moPoints: result.moPoints,
        priority: priorities.get(result.memberId) ?? null,
        reasons: result.reasons.filter((reason) => !reason.satisfied).map((reason) => reason.label),
      } satisfies ImpactScore,
    ]),
  );
}

/** Two controlled comparisons: change rules while holding current evidence
 * constant, then change evidence/cohort while holding prior rules constant.
 * Equal comparator results share a priority; an employee ID never invents a
 * policy tie-break. Neither comparison predicts live choices or awards. */
export function annualEligibilityImpact(input: {
  beforeMembers: ImpactMember[];
  afterMembers: ImpactMember[];
  beforeRules: readonly PositionRule[];
  afterRules: readonly PositionRule[];
}) {
  for (const cohort of [input.beforeMembers, input.afterMembers]) {
    if (new Set(cohort.map((m) => m.memberId)).size !== cohort.length)
      throw new Error('Ambiguous impact member identity');
  }
  for (const rules of [input.beforeRules, input.afterRules]) {
    if (new Set(rules.map((r) => r.positionId)).size !== rules.length)
      throw new Error('Ambiguous impact position identity');
  }
  const priorRules = new Map(input.beforeRules.map((rule) => [rule.positionId, rule]));
  const upcomingRules = new Map(input.afterRules.map((rule) => [rule.positionId, rule]));
  const priorMembers = new Set(input.beforeMembers.map((member) => member.memberId));
  const upcomingMembers = new Set(input.afterMembers.map((member) => member.memberId));
  const policy: ImpactChange[] = [];
  const evidence: ImpactChange[] = [];
  let policyComparisons = 0;
  let evidenceComparisons = 0;
  const changed = (a: ImpactScore, b: ImpactScore) =>
    a.eligible !== b.eligible ||
    a.points !== b.points ||
    a.soPoints !== b.soPoints ||
    a.moPoints !== b.moPoints ||
    a.priority !== b.priority ||
    JSON.stringify(a.reasons) !== JSON.stringify(b.reasons);
  for (const [positionId, oldRule] of priorRules) {
    const newRule = upcomingRules.get(positionId);
    if (!newRule) continue;
    const prior = evaluateCohort(input.beforeMembers, oldRule);
    const fixedEvidence = evaluateCohort(input.afterMembers, oldRule);
    const upcoming = evaluateCohort(input.afterMembers, newRule);
    for (const member of input.afterMembers) {
      const before = fixedEvidence.get(member.memberId);
      const after = upcoming.get(member.memberId);
      if (!before || !after) throw new Error('Missing impact evaluation');
      policyComparisons++;
      if (changed(before, after))
        policy.push({ positionId, memberId: member.memberId, before, after });
      const oldEvidence = prior.get(member.memberId);
      if (oldEvidence) {
        evidenceComparisons++;
        if (changed(oldEvidence, before))
          evidence.push({
            positionId,
            memberId: member.memberId,
            before: oldEvidence,
            after: before,
          });
      }
    }
  }
  return {
    evaluatedComparisons: policyComparisons,
    changed: policy,
    evidence: { evaluatedComparisons: evidenceComparisons, changed: evidence },
    incomparable: {
      addedMemberIds: [...upcomingMembers].filter((id) => !priorMembers.has(id)),
      removedMemberIds: [...priorMembers].filter((id) => !upcomingMembers.has(id)),
      addedPositionIds: [...upcomingRules.keys()].filter((id) => !priorRules.has(id)),
      removedPositionIds: [...priorRules.keys()].filter((id) => !upcomingRules.has(id)),
    },
  };
}
