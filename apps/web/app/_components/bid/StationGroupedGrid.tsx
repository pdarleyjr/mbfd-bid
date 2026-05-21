'use client';
import { useMemo, useState } from 'react';
import positionsRaw from '../../bid/_data/positions.json';
import { RichPositionCell } from './RichPositionCell';
import { ShiftTabs } from './ShiftTabs';
import { ALL_SHIFTS, type MemberLite, type PositionMeta, type Shift } from './types';

interface Props {
  members: Record<string, MemberLite>;
  defaultShift?: Shift | undefined;
  onPositionClick?: ((positionId: string) => void) | undefined;
}

// Display order for stations matches the Excel bid sheet — combat first
// (Stations #1-#4), Rescue Float Pool, then Days / Special / Marine /
// administrative buckets.
const STATION_ORDER = [
  'Station #1',
  'Station #2',
  'Station #3',
  'Station #4',
  'Station #6',
  'Rescue Float Pool',
  'Days',
  'Union President',
];

const ALL_POSITIONS = positionsRaw as PositionMeta[];

/**
 * Group positions into station → apparatus (unit) → ordered list, e.g.:
 *   Station #1
 *     Ladder 1: [A101, A102, A103, A104]
 *     Engine 1: [A105, A106, A107, A108]
 *     Rescue 1: [A109, A110, A111]
 *     ...
 * Within each apparatus the positions are sorted by their id so the
 * hierarchy preserves the operationally meaningful ordering bidders use
 * offline (Captain → Driver/Engineer → FFs).
 */
function groupForShift(shift: Shift): Map<string, Map<string, PositionMeta[]>> {
  const stations = new Map<string, Map<string, PositionMeta[]>>();
  for (const p of ALL_POSITIONS) {
    if (p.shift !== shift) continue;
    const apparatusMap = stations.get(p.station) ?? new Map<string, PositionMeta[]>();
    const list = apparatusMap.get(p.unit) ?? [];
    list.push(p);
    apparatusMap.set(p.unit, list);
    stations.set(p.station, apparatusMap);
  }
  for (const [, apparatusMap] of stations) {
    for (const [, list] of apparatusMap) {
      list.sort((a, b) => a.id.localeCompare(b.id));
    }
  }
  return stations;
}

function countStationPositions(stationMap: Map<string, PositionMeta[]>): number {
  let n = 0;
  for (const [, list] of stationMap) n += list.length;
  return n;
}

function countsByShift(): Partial<Record<Shift, number>> {
  const out: Partial<Record<Shift, number>> = {};
  for (const s of ALL_SHIFTS) out[s] = 0;
  for (const p of ALL_POSITIONS) {
    out[p.shift] = (out[p.shift] ?? 0) + 1;
  }
  return out;
}

/**
 * The new bid board layout — station columns side-by-side, with a shift
 * selector at the top. Replaces the prior flat A101…A801 grid that didn't
 * tell bidders which unit / role a given id belonged to.
 *
 * Layout notes:
 *   - Stations render in `STATION_ORDER`. Any unexpected station name still
 *     renders (appended after the known ones) so a new bucket added to
 *     positions.json doesn't disappear silently.
 *   - On narrow screens stations stack vertically; on wide screens they sit
 *     side-by-side in a horizontally scrollable strip, matching the Excel
 *     bid sheet bidders use offline.
 */
export function StationGroupedGrid({ members, defaultShift = 'A', onPositionClick }: Props) {
  const [shift, setShift] = useState<Shift>(defaultShift);

  const grouped = useMemo(() => groupForShift(shift), [shift]);
  const counts = useMemo(countsByShift, []);

  const orderedStations = useMemo(() => {
    const known = STATION_ORDER.filter((s) => grouped.has(s));
    const unknown = Array.from(grouped.keys()).filter((s) => !STATION_ORDER.includes(s));
    return [...known, ...unknown];
  }, [grouped]);

  return (
    <section aria-label="Bid positions" data-testid="station-grouped-grid">
      <ShiftTabs selected={shift} onSelect={setShift} counts={counts} />
      <div
        id={`shift-panel-${shift}`}
        role="tabpanel"
        aria-labelledby={`shift-tab-${shift}`}
        className="grid gap-4 p-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      >
        {orderedStations.map((stationName) => {
          const apparatusMap = grouped.get(stationName);
          if (!apparatusMap || apparatusMap.size === 0) return null;
          const total = countStationPositions(apparatusMap);
          return (
            <article
              key={stationName}
              data-testid={`station-${stationName.replace(/\W+/g, '-').toLowerCase()}`}
              className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2"
            >
              <header className="rounded-md bg-stone-200 px-3 py-1.5 text-center text-sm font-bold text-stone-900">
                {stationName}
                <span className="ml-2 text-xs font-normal text-stone-600">{total} positions</span>
              </header>
              <div className="flex flex-col gap-3">
                {Array.from(apparatusMap.entries()).map(([apparatus, positions]) => (
                  <section
                    key={apparatus}
                    data-testid={`apparatus-${apparatus.replace(/\W+/g, '-').toLowerCase()}`}
                    className="flex flex-col gap-1"
                  >
                    <h3 className="flex items-center justify-between rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-stone-700">
                      <span>{apparatus}</span>
                      <span className="font-normal text-stone-500">{positions.length}</span>
                    </h3>
                    <div className="flex flex-col gap-1">
                      {positions.map((position) => (
                        <RichPositionCell
                          key={position.id}
                          position={position}
                          members={members}
                          onClick={onPositionClick}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
