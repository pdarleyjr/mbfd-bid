export const PRESENTATION_SHIFTS = ['A', 'B', 'C', 'D'] as const;
export type PresentationShift = (typeof PRESENTATION_SHIFTS)[number];

export type PresentationMember = {
  member_id: number;
  name: string;
  rank: string | null;
  pending_a_day?: boolean;
  current_assignment?: {
    position_id: string | null;
    shift: string | null;
    station: string | null;
    unit: string | null;
    position_name: string | null;
    a_day_group?: string | number | null;
    source_name?: string | null;
  } | null;
  previous_assignment?: {
    position_id: string | null;
    shift: string | null;
    station: string | null;
    unit: string | null;
    position_name: string | null;
    a_day_group?: number | string | null;
  } | null;
};

export type PresentationPosition = {
  id: string;
  shift: string;
  station: string;
  unit: string;
  position_name: string;
  rank_required: string;
  filled_by: PresentationMember | null;
  forced?: boolean;
  /** Retained nonbiddable staffing, displayed without creating a Bid selection. */
  assigned?: boolean;
};

export type PresentationChiefAssignment = PresentationMember & {
  role_label: string;
  forced: true;
};

export type PresentationADayCapacity = {
  id: string;
  label: string;
  pool?: 'OFC' | 'FF';
  maximum: number | null;
  remaining: number | null;
  used: number;
};
export type PresentationADayMember = PresentationMember & {
  position_id: string;
  forced: boolean;
};
export type PresentationADayGroup = {
  shift: PresentationShift;
  value: string;
  maximum: number | null;
  remaining: number | null;
  used: number;
  saved_override: boolean;
  capacities: PresentationADayCapacity[];
  members: PresentationADayMember[];
};
export type PresentationADay = {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  sequence: number;
  groups: PresentationADayGroup[];
  pending: Array<PresentationMember & { shift: PresentationShift; position_id: string }>;
  code?: string;
};

export type PresentationSeat = PresentationPosition & {
  chief_directed?: boolean;
  a_day_capacity?: PresentationADayCapacity;
};
export type PresentationStation = {
  id: string;
  label: string;
  seats: PresentationSeat[];
  a_day_group?: PresentationADayGroup;
  a_day_pending?: boolean;
};
export type PresentationStationPart = PresentationStation & { start: number; total: number };

export function shiftLabel(shift: PresentationShift): string {
  return shift === 'D' ? 'Days' : `${shift} Shift`;
}

function normalizedShift(shift: string): string {
  return /^(D|DAY|DAYS)$/i.test(shift.trim()) ? 'D' : shift.trim().toUpperCase();
}

/** Read-only rows from the public canonical projection. Capacity scopes can
 * overlap, so their remaining values are displayed separately, never summed. */
export function presentationADayStations(
  projection: PresentationADay,
  shift: PresentationShift,
  positions: readonly PresentationPosition[],
): PresentationStation[] {
  if (projection.availability !== 'AVAILABLE') return [];
  const byPosition = new Map(positions.map((position) => [position.id, position]));
  const memberSeat = (
    member: PresentationMember & { position_id: string; forced?: boolean },
    id: string,
    pending = false,
  ): PresentationSeat => {
    const position = byPosition.get(member.position_id);
    return {
      id,
      shift,
      station: '',
      unit: member.position_id,
      position_name: pending
        ? 'A-Day pending'
        : (position?.position_name ?? member.rank ?? 'Member'),
      rank_required: position?.rank_required ?? member.rank ?? '',
      filled_by: member,
      forced: member.forced === true,
    };
  };
  const stations: PresentationStation[] = projection.groups
    .filter((group) => group.shift === shift)
    .map((group) => {
      const id = `a-day:${shift}:${group.value}`;
      return {
        id,
        label: /^G[1-4]$/.test(group.value) ? `Group ${group.value.slice(1)}` : group.value,
        a_day_group: group,
        seats: [
          ...group.capacities.map((capacity) => ({
            id: `${id}:capacity:${capacity.id}`,
            shift,
            station: '',
            unit: '',
            position_name: capacity.label,
            rank_required: '',
            filled_by: null,
            a_day_capacity: capacity,
          })),
          ...group.members.map((member) =>
            memberSeat(member, `${id}:member:${member.member_id}:${member.position_id}`),
          ),
        ],
      };
    });
  const pending = projection.pending.filter((member) => member.shift === shift);
  if (pending.length)
    stations.push({
      id: `a-day:${shift}:pending`,
      label: 'Pending A-Day',
      a_day_pending: true,
      seats: pending.map((member) =>
        memberSeat(
          member,
          `a-day:${shift}:pending:${member.member_id}:${member.position_id}`,
          true,
        ),
      ),
    });
  return stations;
}

export function presentationStations(
  positions: readonly PresentationPosition[],
  shift: PresentationShift,
  chiefAssignments: readonly PresentationChiefAssignment[] = [],
): PresentationStation[] {
  const stations = new Map<string, PresentationStation>();
  for (const position of positions) {
    if (normalizedShift(position.shift) !== shift) continue;
    const id = position.station || (shift === 'D' ? 'Days' : 'Float');
    let station = stations.get(id);
    if (!station) {
      station = {
        id,
        label: /^\d+$/.test(id) ? `Station ${id}` : id,
        seats: [],
      };
      stations.set(id, station);
    }
    station.seats.push(position);
  }
  const sorted = [...stations.values()].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
  if (shift === 'D' && chiefAssignments.length > 0) {
    sorted.push({
      id: 'chief-assignments',
      label: 'Chief assignments',
      seats: chiefAssignments.map((assignment) => ({
        // This is a display key, never a biddable position identifier.
        id: `chief-directed-${assignment.member_id}`,
        shift: 'D',
        station: 'Chief assignments',
        unit: 'Chief directed',
        position_name: assignment.role_label,
        rank_required: assignment.rank ?? '',
        filled_by: assignment,
        forced: true,
        chief_directed: true,
      })),
    });
  }
  return sorted;
}

/** Paginate the actual available frame, preserving every seat and readable text. */
export function presentationBoardPages(
  stations: readonly PresentationStation[],
  width: number,
  height: number,
  measuredSeatHeights: Readonly<Record<string, number>> = {},
  headingHeight = 46,
): { columns: number; pages: PresentationStationPart[][] } {
  const compact = width < 760;
  const columns = Math.max(
    1,
    Math.min(stations.length || 1, Math.floor(width / (compact ? 290 : 225))),
  );
  const rowHeight = compact ? 64 : width >= 2400 ? 48 : 36;
  const availableHeight = Math.max(rowHeight, height - headingHeight);
  const parts: PresentationStationPart[] = [];
  for (const station of stations) {
    if (station.seats.length === 0) {
      parts.push({ ...station, start: 0, total: 0 });
      continue;
    }
    let start = 0;
    while (start < station.seats.length) {
      let usedHeight = 0;
      let end = start;
      while (end < station.seats.length) {
        const seat = station.seats[end];
        if (!seat) break;
        const seatHeight = Math.max(rowHeight, measuredSeatHeights[seat.id] ?? rowHeight);
        if (end > start && usedHeight + seatHeight > availableHeight) break;
        usedHeight += seatHeight;
        end++;
      }
      parts.push({
        ...station,
        seats: station.seats.slice(start, end),
        start,
        total: station.seats.length,
      });
      start = end;
    }
  }
  const pages: PresentationStationPart[][] = [];
  for (let start = 0; start < parts.length; start += columns) {
    pages.push(parts.slice(start, start + columns));
  }
  return { columns, pages: pages.length > 0 ? pages : [[]] };
}

/** Legacy projections still expose on-deck members. Never invent unseen members. */
export function presentationQueue(
  remaining: readonly (PresentationMember | null)[] | undefined,
  current: PresentationMember | null | undefined,
  onDeck: readonly (PresentationMember | null)[] | undefined,
): PresentationMember[] {
  const members = remaining ?? [current ?? null, ...(onDeck ?? [])];
  const seen = new Set<number>();
  return members.filter((member): member is PresentationMember => {
    if (!member || seen.has(member.member_id)) return false;
    seen.add(member.member_id);
    return true;
  });
}
