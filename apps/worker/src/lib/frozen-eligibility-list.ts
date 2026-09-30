import { evaluateEligibilityCohort } from '@mbfd/eligibility';
import type { DB } from '../db/index.js';
import { EligibilityListLoadError } from './admin-eligibility-list.js';
import { eligibilityMemberFromFrozen, loadFrozenSessionBidPolicy } from './bid-policy.js';

/** Session exports retain the accepted annual cohort instead of substituting
 * the general personnel roster or today's mutable qualifications. */
export async function loadFrozenEligibilityListContext(db: DB, sessionId: string) {
  const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozen.ok) throw new EligibilityListLoadError(409, { error: frozen.code });
  const { snapshot, coverage } = frozen;
  const asOf = snapshot.credentialEvaluationOn;
  if (!asOf) throw new EligibilityListLoadError(409, { error: 'session_evaluation_date_missing' });
  const identities = new Map(
    (snapshot.operatorIdentityProjection ?? []).map((identity) => [identity.memberId, identity]),
  );
  const members = snapshot.members
    .filter((member) => member.pool !== 'EXCLUDED')
    .map((member) => {
      const identity = identities.get(member.memberId);
      if (!identity?.employeeId || !identity.firstName || !identity.lastName)
        throw new EligibilityListLoadError(409, { error: 'session_identity_evidence_missing' });
      return {
        ...eligibilityMemberFromFrozen(member),
        employeeId: identity.employeeId,
        firstName: identity.firstName,
        lastName: identity.lastName,
      };
    });
  const rules = new Map(coverage.rules.map((rule) => [rule.positionId, rule]));
  return {
    positionIds: [...rules.keys()].sort(),
    context: {
      sessionId,
      ruleBookVersion: snapshot.ruleBookVersion,
      positionTemplateVersion: snapshot.positionTemplateVersion,
      asOf,
      members: members.map((member) => ({
        id: member.memberId,
        employeeId: member.employeeId,
        firstName: member.firstName,
        lastName: member.lastName,
        rank: member.rank,
      })),
      positions: snapshot.ruleBookMaterial.positions.filter((position) => rules.has(position.id)),
    },
    evaluate(positionId: string) {
      const rule = rules.get(positionId);
      if (!rule)
        throw new EligibilityListLoadError(404, {
          error: 'rule_not_found',
          position_id: positionId,
        });
      return {
        ...evaluateEligibilityCohort({ members, rule, asOf }),
        sessionId,
        metadata: { context: 'FROZEN_SESSION', session_id: sessionId, as_of: asOf },
      };
    },
  };
}
