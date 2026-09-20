import type { BidSessionPolicySnapshot } from '@mbfd/shared';

/** Legacy rehearsal planners cannot enact these opt-in frozen capabilities.
 * Explicit empty arrays retain opt-in semantics; historical absence is unchanged. */
export function requiresCanonicalAnnualExecution(snapshot: BidSessionPolicySnapshot): boolean {
  if (snapshot.v !== 3) return false;
  const operations =
    snapshot.settings.v === 3 ? snapshot.settings.livePolicy.annualOperations : undefined;
  return (
    operations?.opportunityPools !== undefined ||
    operations?.fallbackPolicies !== undefined ||
    operations?.assignmentTerms !== undefined ||
    operations?.membershipDistributions !== undefined ||
    operations?.aDay.execution !== undefined ||
    snapshot.members.some((member) => member.termParticipation !== undefined)
  );
}
