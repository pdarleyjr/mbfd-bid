import { requiredCredsSatisfied } from './criteria/certs.js';
import { driverEngineerSatisfied } from './criteria/driver-engineer.js';
import { nonProbationarySatisfied } from './criteria/non-probationary.js';
import { paramedicSatisfied } from './criteria/paramedic.js';
import { rankSatisfied } from './criteria/rank.js';
import { computeMoPoints } from './points/mo-pool.js';
import { computeSoPoints } from './points/so-pool.js';
import { computePoints } from './points/sum.js';
import type { EligibilityReason, EligibilityResult, Member, PositionRule } from './types.js';

export function evaluateEligibility(member: Member, rule: PositionRule): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  reasons.push(rankSatisfied(member, rule.requiredCriteria.rank));
  reasons.push(...requiredCredsSatisfied(member, rule.requiredCriteria.credentials));

  for (const gate of rule.requiredCriteria.custom) {
    switch (gate) {
      case 'paramedic':
        reasons.push(paramedicSatisfied(member));
        break;
      case 'driver_engineer':
        reasons.push(driverEngineerSatisfied(member));
        break;
      case 'non_probationary':
        reasons.push(nonProbationarySatisfied(member));
        break;
    }
  }

  const eligible = reasons.every((r) => r.satisfied);

  if (!eligible) {
    return {
      eligible: false,
      reasons,
      points: 0,
      soPoints: 0,
      moPoints: 0,
      breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
    };
  }

  const breakdown = computePoints(member, rule);
  const soPoints = computeSoPoints(member);
  const moPoints = computeMoPoints(member);

  return {
    eligible: true,
    reasons,
    points: breakdown.total,
    soPoints,
    moPoints,
    breakdown: { ...breakdown, soTotal: soPoints, moTotal: moPoints },
  };
}
