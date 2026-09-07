import type { Member, PointsBreakdown, ScoringGroup } from '../types.js';

/** Uses only frozen rule material and held evidence. No current catalog or aliases. */
export function configuredChannel(
  member: Pick<Member, 'credentials' | 'memberId' | 'scoringEvidence'>,
  groups: ScoringGroup[],
) {
  const held = new Set(member.credentials.map((c) => c.name));
  const itemized: PointsBreakdown['itemized'] = [];
  let total = 0;
  for (const group of groups) {
    let subtotal = 0;
    for (const item of group.items) {
      const tokens = [item.credential, ...item.alternatives];
      const exception = item.completionCredit;
      const evidence = member.scoringEvidence;
      const completion = !!(
        exception &&
        evidence &&
        exception.sourceRef.trim().length >= 4 &&
        evidence.evaluationOn >= exception.effectiveFrom &&
        evidence.evaluationOn <= exception.effectiveThrough &&
        (!exception.memberIds ||
          (member.memberId !== undefined && exception.memberIds.includes(member.memberId))) &&
        tokens.some((name) => evidence.completedCredentialNames.includes(name))
      );
      const active = tokens.some((name) => held.has(name));
      const possessed = active || completion;
      const missing = item.requiresAll.filter((name) => !held.has(name));
      const credit = possessed && missing.length === 0 ? item.points : 0;
      const awarded =
        group.cap === null ? credit : Math.min(credit, Math.max(0, group.cap - subtotal));
      subtotal += awarded;
      itemized.push({
        credential: item.credential,
        awarded,
        ...(missing.length > 0
          ? { reason: `Missing prerequisites: ${missing.join(', ')}` }
          : awarded < credit
            ? { reason: `Scoring group ${group.id} cap applied` }
            : exception && completion && !active
              ? {
                  reason: `Completion credit authorized by ${exception.sourceRef}; qualification validity unchanged`,
                }
              : {}),
      });
    }
    total += subtotal;
  }
  return { total, itemized };
}
