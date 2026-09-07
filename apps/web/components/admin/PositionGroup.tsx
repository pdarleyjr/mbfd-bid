import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import type { Route } from 'next';
import Link from 'next/link';
import { type BidConfiguration, buildBoundToolHref } from '../../lib/bid-configuration-selection';

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
  configuration: BidConfiguration;
}

export function PositionGroup({ station, positions, configuration }: PositionGroupProps) {
  return (
    <details open className="mt-4 rounded-lg border border-border">
      <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg px-4 py-3 bg-card text-sm font-semibold text-foreground hover:bg-muted transition-colors duration-fast ease-out-quart">
        <span>{station}</span>
        <span className="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
          {positions.length} position{positions.length !== 1 ? 's' : ''}
        </span>
      </summary>
      <div className="overflow-x-auto">
        <Table className="w-full border-collapse text-sm">
          <TableHeader>
            <TableRow className="border-b border-border bg-card">
              <TableHead
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                ID
              </TableHead>
              <TableHead
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Rank
              </TableHead>
              <TableHead
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Position
              </TableHead>
              <TableHead
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Unit
              </TableHead>
              <TableHead
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Division
              </TableHead>
              <TableHead
                scope="col"
                className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Flags
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((pos, idx) => (
              <TableRow
                key={pos.id}
                className={['border-b border-border', idx % 2 === 0 ? 'bg-card' : 'bg-card'].join(
                  ' ',
                )}
              >
                <TableCell className="px-4 py-2 font-mono text-xs text-destructive [font-variant-numeric:tabular-nums]">
                  {configuration.lifecycle === 'DRAFT' ? (
                    <Link
                      href={
                        buildBoundToolHref(
                          `/admin/positions/${encodeURIComponent(pos.id)}/edit`,
                          configuration,
                        ) as Route
                      }
                      className="hover:text-destructive"
                    >
                      {pos.id}
                    </Link>
                  ) : (
                    <span>{pos.id}</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2 text-foreground">
                  {RANK_LABELS[pos.rankRequired] ?? pos.rankRequired}
                </TableCell>
                <TableCell className="px-4 py-2 text-foreground">{pos.positionName}</TableCell>
                <TableCell className="px-4 py-2 text-muted-foreground">{pos.unit}</TableCell>
                <TableCell className="px-4 py-2 text-muted-foreground">{pos.division}</TableCell>
                <TableCell className="px-4 py-2">
                  <span className="flex gap-1 flex-wrap">
                    {pos.isFloating && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                        Float
                      </span>
                    )}
                    {pos.isVacantByDesign && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                        Vacant
                      </span>
                    )}
                    {pos.isExcludedFromCount && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                        Excl
                      </span>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
