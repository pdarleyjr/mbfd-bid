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

function groupForShift(shift: Shift): Map<string, PositionMeta[]> {
  const out = new Map<string, PositionMeta[]>();
  for (const p of ALL_POSITIONS) {
    if (p.shift !== shift) continue;
    const list = out.get(p.station) ?? [];
    list.push(p);
    out.set(p.station, list);
  }
  for (const [, list] of out) list.sort((a, b) => a.id.localeCompare(b.id));
  return out;
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
        className="flex flex-col gap-4 overflow-x-auto p-4 md:flex-row md:items-start"
      >
        {orderedStations.map((stationName) => {
          const positions = grouped.get(stationName) ?? [];
          if (positions.length === 0) return null;
          return (
            <article
              key={stationName}
              data-testid={`station-${stationName.replace(/\W+/g, '-').toLowerCase()}`}
              className="flex w-full shrink-0 flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50 p-2 md:w-72"
            >
              <header className="rounded-md bg-stone-200 px-3 py-1.5 text-center text-sm font-bold text-stone-900">
                {stationName}
                <span className="ml-2 text-xs font-normal text-stone-600">
                  {positions.length} positions
                </span>
              </header>
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
