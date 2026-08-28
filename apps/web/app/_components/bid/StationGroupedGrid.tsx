'use client';
import { useMemo, useState } from 'react';
import { RichPositionCell } from './RichPositionCell';
import { ShiftTabs } from './ShiftTabs';
import { FALLBACK_POSITION_METADATA } from './position-meta';
import { ALL_SHIFTS, type MemberLite, type PositionMeta, type Shift } from './types';

interface Props {
  members: Record<string, MemberLite>;
  defaultShift?: Shift | undefined;
  onPositionClick?: ((positionId: string) => void) | undefined;
  /** Immutable material returned by /api/board for this exact session. */
  positions?: readonly PositionMeta[] | undefined;
  /** A session-bound board must not silently substitute the versionless
   * bundled catalog if its immutable material is absent. */
  snapshotBound?: boolean | undefined;
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
function groupForShift(
  positions: readonly PositionMeta[],
  shift: Shift,
): Map<string, Map<string, PositionMeta[]>> {
  const stations = new Map<string, Map<string, PositionMeta[]>>();
  for (const p of positions) {
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

function countsByShift(positions: readonly PositionMeta[]): Partial<Record<Shift, number>> {
  const out: Partial<Record<Shift, number>> = {};
  for (const s of ALL_SHIFTS) out[s] = 0;
  for (const p of positions) {
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
 *     immutable snapshot doesn't disappear silently.
 *   - On narrow screens stations stack vertically; on wide screens they sit
 *     side-by-side in a horizontally scrollable strip, matching the Excel
 *     bid sheet bidders use offline.
 */
export function StationGroupedGrid({
  members,
  defaultShift = 'A',
  onPositionClick,
  positions: immutablePositions,
  snapshotBound = false,
}: Props) {
  const [shift, setShift] = useState<Shift>(defaultShift);

  // Only a view with no session snapshot may use the historical bundled
  // catalog. A session-bound board needs its own immutable material, otherwise
  // it shows an explicit no-data state rather than inferring current policy.
  const positions = useMemo(
    () => immutablePositions ?? (snapshotBound ? [] : FALLBACK_POSITION_METADATA),
    [immutablePositions, snapshotBound],
  );
  const immutablePositionsUnavailable = snapshotBound && immutablePositions === undefined;

  const grouped = useMemo(() => groupForShift(positions, shift), [positions, shift]);
  const counts = useMemo(() => countsByShift(positions), [positions]);

  const orderedStations = useMemo(() => {
    const known = STATION_ORDER.filter((s) => grouped.has(s));
    const unknown = Array.from(grouped.keys()).filter((s) => !STATION_ORDER.includes(s));
    return [...known, ...unknown];
  }, [grouped]);

  return (
    <section aria-label="Bid positions" data-testid="station-grouped-grid">
      {immutablePositionsUnavailable ? (
        <output
          data-testid="immutable-positions-unavailable"
          className="m-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Immutable session position material is unavailable. The board will not substitute a
          current policy catalog.
        </output>
      ) : (
        <>
          <ShiftTabs selected={shift} onSelect={setShift} counts={counts} />
          <div
            id={`shift-panel-${shift}`}
            role="tabpanel"
            aria-labelledby={`shift-tab-${shift}`}
            className="grid gap-2 p-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
          >
            {orderedStations.map((stationName) => {
              const apparatusMap = grouped.get(stationName);
              if (!apparatusMap || apparatusMap.size === 0) return null;
              const total = countStationPositions(apparatusMap);
              return (
                <article
                  key={stationName}
                  data-testid={`station-${stationName.replace(/\W+/g, '-').toLowerCase()}`}
                  className="flex flex-col gap-1.5 rounded border border-stone-200 bg-stone-50 p-1.5"
                >
                  <header className="rounded bg-stone-200 px-2 py-1 text-center text-xs font-bold text-stone-900">
                    {stationName}
                    <span className="ml-2 text-[10px] font-normal text-stone-600">
                      {total} positions
                    </span>
                  </header>
                  <div className="flex flex-col gap-2">
                    {Array.from(apparatusMap.entries()).map(([apparatus, positions]) => (
                      <section
                        key={apparatus}
                        data-testid={`apparatus-${apparatus.replace(/\W+/g, '-').toLowerCase()}`}
                        className="flex flex-col gap-0.5"
                      >
                        <h3 className="flex items-center justify-between rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-700">
                          <span>{apparatus}</span>
                          <span className="font-normal text-stone-500">{positions.length}</span>
                        </h3>
                        <div className="flex flex-col gap-0.5">
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
        </>
      )}
    </section>
  );
}
