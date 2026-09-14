import type { DepartmentRosterPosition } from '@mbfd/shared';

export interface RosterGroup {
  id: string;
  station: string;
  unit: string | null;
  positions: DepartmentRosterPosition[];
}

export interface RosterFragment {
  group: RosterGroup;
  positions: DepartmentRosterPosition[];
  height: number;
}

export interface RosterMeasurements {
  headings: Record<string, number>;
  rows: Record<string, number>;
  compactRows?: Record<string, number>;
}

export type RosterPage = RosterFragment[][];

/** Display grouping preserves authoritative IDs, including identically named units. */
export function groupRoster(positions: readonly DepartmentRosterPosition[]): RosterGroup[] {
  const groups = new Map<string, RosterGroup>();
  for (const position of positions) {
    const organization = position.organization;
    const hasIdentity = organization && Object.values(organization).some((id) => id !== null);
    const id = hasIdentity
      ? JSON.stringify([
          'organization',
          organization.stationId,
          organization.groupId,
          organization.unitId,
          organization.organizationUnitId,
        ])
      : JSON.stringify(['legacy', position.division, position.station, position.unit]);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        station: position.station || position.division || 'Location not specified',
        unit: position.unit,
        positions: [],
      };
      groups.set(id, group);
    }
    group.positions.push(position);
  }
  return [...groups.values()];
}

/**
 * Packs measured, readable rows without guessing line counts or cutting records.
 * A repeated station/unit heading belongs to every split fragment. No source
 * record is filtered or transformed by the layout algorithm.
 */
export function paginateRoster(
  groups: readonly RosterGroup[],
  measurements: RosterMeasurements,
  columnHeight: number,
  columnCount: number,
  gap = 12,
): { pages: RosterPage[]; oversizedPositionIds: string[] } {
  const columns = Math.max(1, Math.floor(columnCount));
  const pages: RosterPage[] = [];
  const oversizedPositionIds: string[] = [];
  let page: RosterPage = Array.from({ length: columns }, () => []);
  let column = 0;
  let used = 0;
  const nextColumn = () => {
    column += 1;
    used = 0;
    if (column === columns) {
      pages.push(page);
      page = Array.from({ length: columns }, () => []);
      column = 0;
    }
  };
  for (const group of groups) {
    const heading = measurements.headings[group.id];
    if (heading === undefined) return { pages: [], oversizedPositionIds: [] };
    let cursor = 0;
    while (cursor < group.positions.length) {
      const first = group.positions[cursor];
      if (!first) break;
      const firstHeight = measurements.rows[first.id];
      if (firstHeight === undefined) return { pages: [], oversizedPositionIds: [] };
      const separation = used > 0 ? gap : 0;
      const frame = heading + 2; // The shared card has a one-pixel border on each edge.
      if (frame + firstHeight > columnHeight) oversizedPositionIds.push(first.id);
      if (used > 0 && used + separation + frame + firstHeight > columnHeight) {
        nextColumn();
        continue;
      }
      const fragment: RosterFragment = { group, positions: [], height: frame };
      const remaining = columnHeight - used - separation;
      while (cursor < group.positions.length) {
        const position = group.positions[cursor];
        if (!position) break;
        const rowHeight = measurements.rows[position.id];
        if (rowHeight === undefined) return { pages: [], oversizedPositionIds: [] };
        if (fragment.positions.length > 0 && fragment.height + rowHeight > remaining) break;
        fragment.positions.push(position);
        fragment.height += rowHeight;
        cursor += 1;
      }
      page[column]?.push(fragment);
      used += separation + fragment.height;
      if (cursor < group.positions.length) nextColumn();
    }
  }
  if (page.some((items) => items.length > 0)) pages.push(page);
  return { pages, oversizedPositionIds: [...new Set(oversizedPositionIds)] };
}
