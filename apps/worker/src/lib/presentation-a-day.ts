import type { ADayGroupId, Shift, Weekday } from '@mbfd/a-day';
import type { Rank } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import type { Fill, PersistedADayState } from '../durable/bid-session-state.js';
import { frozenADayConstraints } from './frozen-a-day.js';

type PublicMember = { member_id: number; name: string; rank: string | null; position_id: string };
type Capacity = {
  id: string;
  label: string;
  pool?: 'OFC' | 'FF';
  maximum: number | null;
  remaining: number | null;
  used: number;
};
type Group = {
  shift: Shift;
  value: string;
  maximum: number | null;
  remaining: number | null;
  used: number;
  saved_override: boolean;
  capacities: Capacity[];
  members: (PublicMember & { forced: boolean })[];
};

const COMBAT_VALUES = new Set(['G1', 'G2', 'G3', 'G4']);
const DAY_VALUES = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const bounded = (value: number | null | undefined) =>
  value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
const remaining = (maximum: number | null, used: number) =>
  maximum === null ? null : Math.max(0, maximum - used);

/** Member-safe read model only. Use the displayed (LIVE or held) canonical
 * awards, never current/historical staffing, inferred weekdays or an engine's
 * uncapped fallback number. No selector, receipt, actor or authority is exposed. */
export function projectPresentationADays(input: {
  snapshot: BidSessionPolicySnapshot;
  fills: Readonly<Record<string, Fill>>;
  aDay: PersistedADayState | null;
  sequence: number;
  /** Current canonical pending rights; completed turns retain unknown choices. */
  pendingMemberIds?: readonly number[];
}) {
  const unavailable = (code: string) => ({
    availability: 'UNAVAILABLE' as const,
    sequence: input.sequence,
    groups: [] as Group[],
    pending: [] as (PublicMember & { shift: Shift })[],
    code,
  });
  if (input.snapshot.v !== 3 || input.snapshot.settings.v !== 3)
    return unavailable('A_DAY_PRESENTATION_POLICY_UNAVAILABLE');
  const annual = input.snapshot.settings.livePolicy.annualOperations;
  if (!annual) return unavailable('A_DAY_PRESENTATION_POLICY_UNAVAILABLE');
  const positions = new Map(input.snapshot.ruleBookMaterial.positions.map((p) => [p.id, p]));
  const identities = new Map(
    (input.snapshot.operatorIdentityProjection ?? []).map((member) => [member.memberId, member]),
  );
  const members = new Map(input.snapshot.members.map((member) => [member.memberId, member]));
  const groups = new Map<string, Group>();
  const pending: (PublicMember & { shift: Shift })[] = [];
  const configured = new Set<string>();
  const declaredMaximum = bounded(annual.aDay.max);
  const makeGroup = (shift: Shift, value: string, isConfigured: boolean): Group => {
    const key = `${shift}:${value}`;
    const maximum = !isConfigured
      ? null
      : shift === 'D'
        ? bounded(input.aDay?.weekdayCaps[value as Weekday]?.max)
        : declaredMaximum === null
          ? null
          : bounded(input.aDay?.groupCaps[shift][value as ADayGroupId]?.max ?? declaredMaximum);
    const group: Group = {
      shift,
      value,
      maximum,
      remaining: maximum,
      used: 0,
      // D weekdays are uncapped when absent from weekdayCaps; a saved weekday
      // does not by itself imply an administrator departure.
      saved_override: !isConfigured && shift !== 'D',
      capacities: [],
      members: [],
    };
    groups.set(key, group);
    if (isConfigured) configured.add(key);
    return group;
  };
  for (const shift of ['A', 'B', 'C'] as const)
    for (const value of annual.aDay.combatGroups) {
      if (!COMBAT_VALUES.has(value)) return unavailable('A_DAY_PRESENTATION_GROUP_INVALID');
      makeGroup(shift, value, true);
    }
  for (const value of Object.keys(input.aDay?.weekdayCaps ?? {})) {
    if (!DAY_VALUES.has(value)) return unavailable('A_DAY_PRESENTATION_GROUP_INVALID');
    makeGroup('D', value, true);
  }
  const assignments = new Map<
    number,
    { positionId: string; fill: Fill; rank: Rank; pool: 'OFC' | 'FF' }
  >();
  for (const [positionId, fill] of Object.entries(input.fills)) {
    const position = positions.get(positionId);
    const member = members.get(fill.memberId);
    const identity = identities.get(fill.memberId);
    if (
      !position ||
      position.bidParticipation !== 'BIDDABLE' ||
      !member ||
      !member.rank ||
      member.rank === 'CIVILIAN' ||
      member.pool === 'EXCLUDED' ||
      !identity ||
      assignments.has(fill.memberId)
    )
      return unavailable('A_DAY_PRESENTATION_ASSIGNMENT_UNAVAILABLE');
    assignments.set(fill.memberId, {
      positionId,
      fill,
      rank: member.rank,
      pool: member.pool,
    });
    const shown = {
      member_id: fill.memberId,
      name: `${identity.firstName} ${identity.lastName}`,
      rank: identity.rank,
      position_id: positionId,
    };
    const picks = (input.aDay?.picks ?? []).filter(
      (pick) => pick.memberId === fill.memberId && pick.shift === position.shift,
    );
    if (picks.length > 1) return unavailable('A_DAY_PRESENTATION_PICK_CONFLICT');
    const boundPick = input.aDay?.phase1.some(
      ([id, assignment]) =>
        id === fill.memberId &&
        assignment.positionId === positionId &&
        assignment.shift === position.shift,
    )
      ? picks[0]
      : undefined;
    const value = fill.aDay ?? boundPick?.aDay;
    if (value === undefined) {
      if (input.pendingMemberIds === undefined || input.pendingMemberIds.includes(fill.memberId))
        pending.push({ ...shown, shift: position.shift });
      continue;
    }
    if (!(position.shift === 'D' ? DAY_VALUES : COMBAT_VALUES).has(value))
      return unavailable('A_DAY_PRESENTATION_GROUP_INVALID');
    if (boundPick !== undefined && boundPick.aDay !== value)
      return unavailable('A_DAY_PRESENTATION_PICK_CONFLICT');
    const key = `${position.shift}:${value}`;
    const group = groups.get(key) ?? makeGroup(position.shift, value, false);
    const override = fill.aDayOverride?.aDay === value;
    group.saved_override ||= override;
    group.members.push({
      ...shown,
      forced: boundPick?.forced === true || fill.forced !== undefined,
    });
  }
  const constraints = input.aDay?.constraints ?? frozenADayConstraints(annual);
  for (const group of groups.values()) {
    group.used = group.members.length;
    group.remaining = remaining(group.maximum, group.used);
    const officerMaximum =
      group.shift !== 'D' && configured.has(`${group.shift}:${group.value}`)
        ? bounded(annual.aDay.execution?.officersPerGroup)
        : null;
    group.capacities = (['OFC', 'FF'] as const).map((pool) => {
      const used = group.members.filter(
        (member) => assignments.get(member.member_id)?.pool === pool,
      ).length;
      // An exact officer quota is explicit. A separate FF quota is not inferred
      // by subtracting officers from a global cap; scoped declarations follow.
      const maximum = pool === 'OFC' ? officerMaximum : null;
      return {
        id: `pool:${pool}`,
        label: pool === 'OFC' ? 'Officers' : 'Firefighters',
        pool,
        maximum,
        used,
        remaining: remaining(maximum, used),
      };
    });
    for (const constraint of constraints) {
      if (constraint.shifts && !constraint.shifts.includes(group.shift)) continue;
      const used = group.members.filter((member) => {
        const assignment = assignments.get(member.member_id);
        return (
          constraint.memberIds.includes(member.member_id) ||
          constraint.positionIds.includes(member.position_id) ||
          (assignment !== undefined && constraint.ranks.includes(assignment.rank))
        );
      }).length;
      const maximum = configured.has(`${group.shift}:${group.value}`)
        ? bounded(constraint.maximum)
        : null;
      group.capacities.push({
        id: `constraint:${constraint.id}`,
        label: constraint.label,
        maximum,
        used,
        remaining: remaining(maximum, used),
      });
    }
    for (const distribution of annual.membershipDistributions ?? []) {
      if (group.shift === 'D' || !distribution.shifts.includes(group.shift)) continue;
      const used = group.members.filter((member) =>
        distribution.membershipSource === 'REVIEWED_QUALIFIED_POOL'
          ? assignments.get(member.member_id)?.fill.membershipIds?.includes(distribution.id)
          : distribution.memberIds.includes(member.member_id),
      ).length;
      const maximum = configured.has(`${group.shift}:${group.value}`)
        ? bounded(distribution.maximumPerADay)
        : null;
      group.capacities.push({
        id: `membership:${distribution.id}`,
        label: distribution.label,
        maximum,
        used,
        remaining: remaining(maximum, used),
      });
    }
  }
  return {
    availability: 'AVAILABLE' as const,
    sequence: input.sequence,
    groups: [...groups.values()],
    pending,
  };
}
