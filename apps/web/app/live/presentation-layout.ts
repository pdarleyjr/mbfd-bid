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
};

export type PresentationChiefAssignment = PresentationMember & {
  role_label: string;
  forced: true;
};

export type PresentationSeat = PresentationPosition & { chief_directed?: boolean };
export type PresentationStation = { id: string; label: string; seats: PresentationSeat[] };
export type PresentationStationPart = PresentationStation & { start: number; total: number };

export function shiftLabel(shift: PresentationShift): string {
  return shift === 'D' ? 'Days' : `${shift} Shift`;
}

function normalizedShift(shift: string): string {
  return /^(D|DAY|DAYS)$/i.test(shift.trim()) ? 'D' : shift.trim().toUpperCase();
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
): { columns: number; pages: PresentationStationPart[][] } {
  const compact = width < 760;
  const columns = Math.max(
    1,
    Math.min(stations.length || 1, Math.floor(width / (compact ? 290 : 225))),
  );
  const rowHeight = compact ? 64 : width >= 2400 ? 48 : 36;
  const availableHeight = Math.max(rowHeight, height - 46);
  const parts: PresentationStationPart[] = [];
  for (const station of stations) {
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
