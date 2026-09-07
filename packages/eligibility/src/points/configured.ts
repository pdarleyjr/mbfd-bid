import type { Member, PointsBreakdown, ScoringGroup } from '../types.js';

/** Uses only frozen rule material and held evidence. No current catalog or aliases. */
export function configuredChannel(member: Pick<Member, 'credentials'>, groups: ScoringGroup[]) {
  const held = new Set(member.credentials.map((c) => c.name));
  const itemized: PointsBreakdown['itemized'] = [];
  let total = 0;
  for (const group of groups) {
    let subtotal = 0;
    for (const item of group.items) {
      const possessed = [item.credential, ...item.alternatives].some((name) => held.has(name));
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
            : {}),
      });
    }
    total += subtotal;
  }
  return { total, itemized };
}
