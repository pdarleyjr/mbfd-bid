import { requiredCredsSatisfied } from './criteria/certs.js';
import { driverEngineerSatisfied } from './criteria/driver-engineer.js';
import { nonProbationarySatisfied } from './criteria/non-probationary.js';
import { paramedicSatisfied } from './criteria/paramedic.js';
import { rankSatisfied } from './criteria/rank.js';
import { configuredChannel } from './points/configured.js';
import { computeMoPoints } from './points/mo-pool.js';
import { computeSoPoints } from './points/so-pool.js';
import { computePoints } from './points/sum.js';
import type { EligibilityReason, EligibilityResult, Member, PositionRule } from './types.js';

export function evaluateEligibility(member: Member, rule: PositionRule): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  reasons.push(rankSatisfied(member, rule.requiredCriteria.rank));
  reasons.push(...requiredCredsSatisfied(member, rule.requiredCriteria.credentials));
  const held = new Set(member.credentials.map((credential) => credential.name));
  for (const [index, group] of (rule.requiredCriteria.anyOfCredentials ?? []).entries())
    reasons.push({
      code: `qualification_alternative_${index + 1}`,
      label: `Requires one of: ${group.join(' or ')}`,
      satisfied: group.length > 0 && group.some((name) => held.has(name)),
    });

  for (const requirement of rule.requiredCriteria.service ?? []) {
    const credits =
      member.serviceCredits?.filter((credit) => credit.serviceCode === requirement.serviceCode) ??
      [];
    const credit = credits.length === 1 ? credits[0] : undefined;
    const known = credit?.verifiedMonths !== null && credit?.verifiedMonths !== undefined;
    reasons.push({
      code: known ? 'service_months' : 'service_evidence_unknown',
      label: known
        ? `${requirement.serviceCode}: ${credit?.verifiedMonths} reviewed cumulative months; ${requirement.minimumMonths} required`
        : `${requirement.serviceCode}: cumulative service evidence requires review`,
      satisfied: known && (credit?.verifiedMonths ?? -1) >= requirement.minimumMonths,
    });
  }
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

  const configured = rule.pointsPreference.scoring;
  if (configured !== undefined) {
    const total = configuredChannel(member, configured.total);
    const so = configuredChannel(member, configured.so);
    const mo = configuredChannel(member, configured.mo);
    return {
      eligible: true,
      reasons,
      points: total.total,
      soPoints: so.total,
      moPoints: mo.total,
      breakdown: {
        total: total.total,
        soTotal: so.total,
        moTotal: mo.total,
        itemized: total.itemized,
      },
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
