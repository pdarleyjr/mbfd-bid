import { holdsAllOps, opsForTech } from '../operations-techs.js';
import type { Member, PointsBreakdown, PositionRule } from '../types.js';

export function computePoints(member: Member, rule: PositionRule): PointsBreakdown {
  const heldCreds = new Set(member.credentials.map((c) => c.name));
  const itemized: PointsBreakdown['itemized'] = [];
  let rawTotal = 0;

  for (const item of rule.pointsPreference.items) {
    if (!heldCreds.has(item.credential)) {
      itemized.push({ credential: item.credential, awarded: 0 });
      continue;
    }

    const opsGate = item.opsGate ?? (item.requiresOpsPair ? 'paired_operation' : undefined);

    if (opsGate === 'all_operations' && !holdsAllOps(heldCreds)) {
      itemized.push({
        credential: item.credential,
        awarded: 0,
        reason: 'Technician cert requires all six Operations certifications',
      });
      continue;
    }

    if (opsGate === 'paired_operation') {
      const requiredOps = opsForTech(item.credential);
      if (requiredOps !== undefined && !heldCreds.has(requiredOps)) {
        itemized.push({
          credential: item.credential,
          awarded: 0,
          reason: `Technician cert requires paired Operations cert: ${requiredOps}`,
        });
        continue;
      }
    }

    itemized.push({ credential: item.credential, awarded: item.points });
    rawTotal += item.points;
  }

  const max = rule.pointsPreference.max;
  const total = max > 0 ? Math.min(rawTotal, max) : rawTotal;

  return { total, soTotal: 0, moTotal: 0, itemized };
}
