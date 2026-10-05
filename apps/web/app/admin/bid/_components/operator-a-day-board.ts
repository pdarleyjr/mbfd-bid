import type { PositionMeta, Shift } from '../../../_components/bid/types';

export type OperatorADayProjection = {
  sessionId: string;
  sequence: number;
  combatGroups: readonly string[];
  maximumPerGroup: number | null;
  fills: Record<string, { member_id: number; a_day?: string | null; forced?: unknown }>;
};

/** A read-only grouping of saved selections, never a second eligibility engine. */
export function projectADayBoard(
  projection: OperatorADayProjection,
  positions: readonly PositionMeta[],
  shift: Shift,
) {
  const positionById = new Map(positions.map((position) => [position.id, position]));
  const seats = Object.entries(projection.fills).flatMap(([positionId, fill]) => {
    const position = positionById.get(positionId);
    return position?.shift === shift
      ? [{ position, memberId: fill.member_id, aDay: fill.a_day, forced: fill.forced }]
      : [];
  });
  const groups =
    shift === 'D' ? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] : projection.combatGroups;
  return {
    groups: groups.map((id) => {
      const taken = seats.filter((seat) => seat.aDay === id);
      const maximum = shift === 'D' ? null : projection.maximumPerGroup;
      return {
        id,
        taken,
        maximum,
        remaining: maximum === null ? null : Math.max(0, maximum - taken.length),
      };
    }),
    pending: seats.filter((seat) => !seat.aDay),
  };
}
