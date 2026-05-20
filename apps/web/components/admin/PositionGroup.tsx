import type { Route } from 'next';
import Link from 'next/link';

interface Position {
  id: string;
  templateVersion: string;
  shift: string;
  station: string;
  division: string;
  unit: string;
  rankRequired: string;
  positionName: string;
  isFloating: boolean;
  isVacantByDesign: boolean;
  isExcludedFromCount: boolean;
}

const RANK_LABELS: Record<string, string> = {
  FF: 'FF',
  LT: 'LT',
  CPT: 'CPT',
  DC: 'DC',
};

interface PositionGroupProps {
  station: string;
  positions: Position[];
}

export function PositionGroup({ station, positions }: PositionGroupProps) {
  return (
    <details open className="mt-4 rounded-lg border border-slate-700">
      <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg px-4 py-3 bg-slate-800 text-sm font-semibold text-slate-200 hover:bg-slate-750 transition-colors duration-fast ease-out-quart">
        <span>{station}</span>
        <span className="font-mono text-xs text-slate-500 [font-variant-numeric:tabular-nums]">
          {positions.length} position{positions.length !== 1 ? 's' : ''}
        </span>
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-850">
              <th
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                ID
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Rank
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Position
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Unit
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Division
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Flags
              </th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, idx) => (
              <tr
                key={pos.id}
                className={[
                  'border-b border-slate-700',
                  idx % 2 === 0 ? 'bg-slate-850' : 'bg-slate-800',
                ].join(' ')}
              >
                <td className="px-4 py-2 font-mono text-xs text-red-400 [font-variant-numeric:tabular-nums]">
                  <Link
                    href={`/admin/positions/${pos.id}/edit` as Route}
                    className="hover:text-red-300"
                  >
                    {pos.id}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-300">
                  {RANK_LABELS[pos.rankRequired] ?? pos.rankRequired}
                </td>
                <td className="px-4 py-2 text-slate-200">{pos.positionName}</td>
                <td className="px-4 py-2 text-slate-400">{pos.unit}</td>
                <td className="px-4 py-2 text-slate-400">{pos.division}</td>
                <td className="px-4 py-2">
                  <span className="flex gap-1 flex-wrap">
                    {pos.isFloating && (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                        Float
                      </span>
                    )}
                    {pos.isVacantByDesign && (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                        Vacant
                      </span>
                    )}
                    {pos.isExcludedFromCount && (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                        Excl
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
