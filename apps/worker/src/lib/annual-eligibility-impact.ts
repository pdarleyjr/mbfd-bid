import {
  type Member,
  type PositionRule,
  compare,
  evaluateEligibility,
  missingBidOrdinalKeys,
} from '@mbfd/eligibility';

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

export function evaluateImpactCohort(members: ImpactMember[], rule: PositionRule) {
  const evaluated = members.map((member) => ({
    memberId: member.memberId,
    ...evaluateEligibility(member.evidence, rule),
    rscSeniority: member.evidence.rscSeniority,
    rankSeniority: member.evidence.rankSeniority ?? Number.MAX_SAFE_INTEGER,
    bidOrdinalEvidence: member.evidence.bidOrdinalEvidence,
  }));
  const missingOrderingEvidence = evaluated.some(
    (result) => result.eligible && missingBidOrdinalKeys(result, rule.tieBreakChain).length > 0,
  );
  const ranked = (missingOrderingEvidence ? [] : evaluated)
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
        reasons: [
          ...result.reasons.filter((reason) => !reason.satisfied).map((reason) => reason.label),
          ...(result.eligible && missingOrderingEvidence
            ? [
                'Bid priority unavailable: required reviewed Bid ordinal evidence is missing in this cohort.',
              ]
            : []),
        ],
      } satisfies ImpactScore,
    ]),
  );
}

/** Two controlled comparisons: change rules while holding current evidence
 * constant, then change evidence/cohort while holding prior rules constant.
 * Equal comparator results share a priority; an employee ID never invents a
 * policy tie-break. Neither comparison predicts live choices or awards. */
export function annualEligibilityImpact(
  input: {
    beforeMembers: ImpactMember[];
    afterMembers: ImpactMember[];
    beforeRules: readonly PositionRule[];
    afterRules: readonly PositionRule[];
  },
  observe?: {
    /** Request-scoped streaming keeps full-population previews bounded in memory.
     * Returning false omits only the serialized row, never its calculation. */
    change?: (cause: 'POLICY' | 'EVIDENCE', change: ImpactChange) => boolean;
    position?: (
      positionId: string,
      before: ReadonlyMap<number, ImpactScore>,
      after: ReadonlyMap<number, ImpactScore>,
    ) => void;
  },
) {
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
    const prior = evaluateImpactCohort(input.beforeMembers, oldRule);
    const fixedEvidence = evaluateImpactCohort(input.afterMembers, oldRule);
    const upcoming = evaluateImpactCohort(input.afterMembers, newRule);
    observe?.position?.(positionId, prior, upcoming);
    for (const member of input.afterMembers) {
      const before = fixedEvidence.get(member.memberId);
      const after = upcoming.get(member.memberId);
      if (!before || !after) throw new Error('Missing impact evaluation');
      policyComparisons++;
      if (changed(before, after)) {
        const change = { positionId, memberId: member.memberId, before, after };
        if (observe?.change?.('POLICY', change) !== false) policy.push(change);
      }
      const oldEvidence = prior.get(member.memberId);
      if (oldEvidence) {
        evidenceComparisons++;
        if (changed(oldEvidence, before)) {
          const change = {
            positionId,
            memberId: member.memberId,
            before: oldEvidence,
            after: before,
          };
          if (observe?.change?.('EVIDENCE', change) !== false) evidence.push(change);
        }
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
