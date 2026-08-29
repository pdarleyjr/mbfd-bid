import { PositionGroup } from '@/components/admin/PositionGroup';
import type { BoundToolSearchParams } from '@/lib/bid-configuration-selection';
import { loadBoundBidConfiguration } from '@/lib/load-bound-bid-configuration';
import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';
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

interface PositionsResponse {
  positions: Position[];
  templateVersion: string;
  count: number;
}

const SHIFT_ORDER = ['A', 'B', 'C', 'D'];

export default async function AdminPositionsPage({
  searchParams,
}: {
  searchParams: Promise<BoundToolSearchParams>;
}) {
  await requireAdmin();

  const binding = await loadBoundBidConfiguration(await searchParams);
  if (binding.error !== null) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-white">Positions</h1>
        <p className="mt-6 rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-6 text-sm text-amber-100">
          {binding.error}{' '}
          <Link href="/admin/bid-setup" className="font-semibold underline">
            Return to Bid Setup
          </Link>
        </p>
      </div>
    );
  }

  const client = await getServerRpc();

  let positions: Position[] = [];
  let templateVersion = binding.configuration.positionTemplateVersion;
  let fetchError: string | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.positions.$get({
      query: { template_version: binding.configuration.positionTemplateVersion },
    });
    if (res.ok) {
      const data = (await res.json()) as PositionsResponse;
      positions = data.positions;
      templateVersion = data.templateVersion;
    } else {
      fetchError = `API error: ${res.status}`;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch positions';
  }

  // Group by shift → station
  const byShift = new Map<string, Map<string, Position[]>>();
  for (const pos of positions) {
    if (!byShift.has(pos.shift)) {
      byShift.set(pos.shift, new Map());
    }
    const byStation = byShift.get(pos.shift) as Map<string, Position[]>;
    if (!byStation.has(pos.station)) {
      byStation.set(pos.station, []);
    }
    (byStation.get(pos.station) as Position[]).push(pos);
  }

  const shifts = SHIFT_ORDER.filter((s) => byShift.has(s));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-white">Positions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Template: <span className="font-mono text-slate-300">{templateVersion}</span>
            {!fetchError && (
              <>
                {' '}
                &bull; {positions.length} position{positions.length !== 1 ? 's' : ''}
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Annual configuration: year {binding.configuration.bidYear} &bull; rule book{' '}
            <span className="font-mono text-slate-300">
              {binding.configuration.ruleBookVersion}
            </span>{' '}
            &bull; template{' '}
            <span className="font-mono text-slate-300">
              {binding.configuration.positionTemplateVersion}
            </span>
          </p>
        </div>
      </div>

      {fetchError ? (
        <p className="mt-6 rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-6 text-center text-slate-300">
          Could not load positions. Check worker connectivity.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {shifts.map((shift) => {
            const byStation = byShift.get(shift) as Map<string, Position[]>;
            const stations = Array.from(byStation.keys()).sort();
            return (
              <section key={shift}>
                <h2 className="font-heading text-lg text-white">Shift {shift}</h2>
                {stations.map((station) => (
                  <PositionGroup
                    key={station}
                    station={station}
                    positions={byStation.get(station) as Position[]}
                    configuration={binding.configuration}
                  />
                ))}
              </section>
            );
          })}

          {shifts.length === 0 && (
            <p className="text-center text-slate-500">
              No positions found for template {templateVersion}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
