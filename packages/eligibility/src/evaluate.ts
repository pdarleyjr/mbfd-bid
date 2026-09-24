import { credentialSatisfiesMinimum, requiredCredsSatisfied } from './criteria/certs.js';
import { driverEngineerSatisfied } from './criteria/driver-engineer.js';
import { nonProbationarySatisfied } from './criteria/non-probationary.js';
import { paramedicSatisfied } from './criteria/paramedic.js';
import { rankSatisfied } from './criteria/rank.js';
import { evaluateOrderedPreference } from './ordered-preference.js';
import { configuredChannel } from './points/configured.js';
import { computeMoPoints } from './points/mo-pool.js';
import { computeSoPoints } from './points/so-pool.js';
import { computePoints } from './points/sum.js';
import type { EligibilityReason, EligibilityResult, Member, PositionRule } from './types.js';

export function evaluateEligibility(member: Member, rule: PositionRule): EligibilityResult {
  return evaluateWithChannels(member, rule);
}

export type EligibilityChannels = Record<
  'total' | 'so' | 'mo',
  {
    total: number;
    itemized: EligibilityResult['breakdown']['itemized'];
  }
>;

/** Diagnostics are produced during the same calculation, without a second
 * scoring implementation or changes to the established runtime result shape. */
export function evaluateEligibilityWithTrace(member: Member, rule: PositionRule) {
  const channels: EligibilityChannels = {
    total: { total: 0, itemized: [] },
    so: { total: 0, itemized: [] },
    mo: { total: 0, itemized: [] },
  };
  const result = evaluateWithChannels(member, rule, channels);
  return { result, channels };
}

function evaluateWithChannels(
  member: Member,
  rule: PositionRule,
  channels?: EligibilityChannels,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const evaluationOn = member.scoringEvidence?.evaluationOn;
  const activeMember: Member = {
    ...member,
    credentials: member.credentials.filter(
      (credential) =>
        (credential.status === undefined || credential.status === 'active') &&
        (evaluationOn === undefined ||
          credential.effectiveOn === undefined ||
          credential.effectiveOn === null ||
          credential.effectiveOn <= evaluationOn) &&
        (evaluationOn === undefined ||
          credential.expiresOn === undefined ||
          credential.expiresOn === null ||
          credential.expiresOn >= evaluationOn),
    ),
  };

  reasons.push(rankSatisfied(member, rule.requiredCriteria.rank));
  reasons.push(...requiredCredsSatisfied(member, rule.requiredCriteria.credentials));
  for (const [index, group] of (rule.requiredCriteria.anyOfCredentials ?? []).entries())
    reasons.push({
      code: `qualification_alternative_${index + 1}`,
      label: `Requires one of: ${group.join(' or ')}`,
      satisfied:
        group.length > 0 &&
        group.some((name) =>
          activeMember.credentials.some((credential) =>
            credentialSatisfiesMinimum(credential.name, name),
          ),
        ),
    });

  for (const requirement of rule.requiredCriteria.service ?? []) {
    const credits =
      member.serviceCredits?.filter((credit) => credit.serviceCode === requirement.serviceCode) ??
      [];
    const credit = credits.length === 1 ? credits[0] : undefined;
    const verifiedMonths = credit?.verifiedMonths;
    const known = verifiedMonths !== null && verifiedMonths !== undefined;
    reasons.push({
      code: known ? 'service_months' : 'service_evidence_unknown',
      label: known
        ? `${requirement.serviceCode}: ${verifiedMonths} reviewed cumulative months; ${requirement.minimumMonths} required`
        : `${requirement.serviceCode}: cumulative service evidence requires review`,
      satisfied: known && verifiedMonths >= requirement.minimumMonths,
    });
  }
  for (const gate of rule.requiredCriteria.custom) {
    switch (gate) {
      case 'paramedic':
        reasons.push(paramedicSatisfied(activeMember));
        break;
      case 'driver_engineer':
        reasons.push(driverEngineerSatisfied(activeMember));
        break;
      case 'non_probationary':
        reasons.push(nonProbationarySatisfied(activeMember));
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
    const total = configuredChannel(activeMember, configured.total);
    const so = configuredChannel(activeMember, configured.so);
    const mo = configuredChannel(activeMember, configured.mo);
    if (channels) {
      channels.total = total;
      channels.so = so;
      channels.mo = mo;
    }
    return {
      eligible: true,
      ...(configured.orderedPreference === undefined
        ? {}
        : {
            orderedPreference: evaluateOrderedPreference(
              activeMember,
              configured.orderedPreference,
            ),
          }),
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
  const breakdown = computePoints(activeMember, rule);
  const soPoints = computeSoPoints(
    activeMember,
    channels
      ? (credential) => {
          channels.so.itemized.push({ credential, awarded: 1 });
        }
      : undefined,
  );
  const moPoints = computeMoPoints(
    activeMember,
    channels
      ? (credential, reason) => {
          channels.mo.itemized.push({
            credential,
            awarded: 1,
            ...(reason === undefined ? {} : { reason }),
          });
        }
      : undefined,
  );
  if (channels) {
    channels.total = { total: breakdown.total, itemized: breakdown.itemized };
    channels.so.total = soPoints;
    channels.mo.total = moPoints;
  }

  return {
    eligible: true,
    reasons,
    points: breakdown.total,
    soPoints,
    moPoints,
    breakdown: { ...breakdown, soTotal: soPoints, moTotal: moPoints },
  };
}
