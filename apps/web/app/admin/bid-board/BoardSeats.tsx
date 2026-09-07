'use client';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminBidBoard } from '@mbfd/shared';
import { Building2, ChevronDown } from 'lucide-react';
import { useState } from 'react';

type Seat = AdminBidBoard['seats'][number];
const title = (s: string | null) => (s === null || s === '' ? 'Unmapped / Review Required' : s);

function SeatAssignment({ seat }: { seat: Seat }) {
  return (
    <>
      {'participation' in seat && (
        <>
          <p>
            {seat.participation === 'BIDDABLE'
              ? 'Biddable'
              : seat.participation === 'RESERVED_NON_BIDDABLE'
                ? 'Reserved · Not biddable'
                : 'Administratively assigned · Not biddable'}
          </p>
          {seat.mapping === 'review_required' && (
            <p className="mt-1 text-warning">Unmapped / Review Required</p>
          )}
        </>
      )}
      {'occupant' in seat && (
        <>
          <p
            className={
              seat.occupancy === 'vacant' || seat.occupancy === 'unmapped'
                ? 'font-medium text-warning'
                : ''
            }
          >
            {seat.occupancy === 'unmapped'
              ? 'Unmapped / Review Required'
              : (seat.occupant?.name ??
                (seat.occupancy === 'vacant' ? 'Vacant' : 'Member name unavailable'))}
          </p>
          {seat.assignmentOrigin && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Assignment source: {seat.assignmentOrigin.replaceAll('_', ' ')}
            </p>
          )}
          {seat.temporaryContext.map((overlay) => (
            <p key={overlay.id} className="mt-2 text-xs text-warning">
              {overlay.kind === 'LIGHT_DUTY' ? 'Light duty' : 'Temporary special assignment'} from{' '}
              {overlay.effectiveOn}. Underlying assignment retained.
              {overlay.plannedEndOn ? ` Planned end ${overlay.plannedEndOn}.` : ''}
            </p>
          ))}
        </>
      )}
      {'award' in seat && (
        <>
          <p>
            {seat.award
              ? (seat.award.name ??
                `Member reference ${seat.award.memberId} · Historical name unavailable`)
              : 'No final award'}
          </p>
          {seat.aDay && <Badge className="mt-1">A-Day {seat.aDay}</Badge>}
        </>
      )}
    </>
  );
}
function GroupRows({ seats }: { seats: Seat[] }) {
  const groups = [...new Set(seats.map((seat) => seat.unit))];
  return (
    <>
      {groups.map((unit) => (
        <div key={unit ?? 'unmapped'} className="border-t border-border first:border-t-0">
          <h3 className="bg-muted/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            {title(unit)}
          </h3>
          <Table className="table-fixed text-xs">
            <TableHeader className="sr-only">
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead>Assignment or participation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seats
                .filter((seat) => seat.unit === unit)
                .map((seat) => (
                  <TableRow key={seat.id}>
                    <TableCell className="w-1/2 break-words px-3 py-2 font-medium">
                      <p>{title(seat.position)}</p>
                      <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                        {seat.rank ?? 'Rank requires review'}
                      </span>
                    </TableCell>
                    <TableCell className="break-words px-3 py-2">
                      <SeatAssignment seat={seat} />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </>
  );
}
function StationRosterCard({
  station,
  seats,
  searching,
}: { station: string | null; seats: Seat[]; searching: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 8;
  const first = searching ? seats : seats.slice(0, limit);
  const remaining = searching ? [] : seats.slice(limit);
  return (
    <Card className="min-w-0 overflow-hidden self-start" data-testid="station-roster-card">
      <header className="flex items-center gap-2 border-b border-border bg-station-header px-3 py-3">
        <Building2 size={18} className="shrink-0 text-warning" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 font-heading text-sm font-bold">
          {station === null
            ? title(station)
            : /^\d+$/.test(station)
              ? `Station ${station}`
              : station}
        </h2>
        <Badge className="shrink-0 bg-card">
          {seats.length} {seats.length === 1 ? 'position' : 'positions'}
        </Badge>
      </header>
      <GroupRows seats={first} />
      {remaining.length > 0 && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleContent>
            <GroupRows seats={remaining} />
          </CollapsibleContent>
          <CollapsibleTrigger
            className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} w-full rounded-none border-t border-border text-info`}
          >
            {expanded ? 'Show fewer positions' : `View ${remaining.length} more positions`}
            <ChevronDown size={15} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
          </CollapsibleTrigger>
        </Collapsible>
      )}
    </Card>
  );
}
/** All grouping, counts and identity are derived from the selected response only. */
export function BoardSeats({ board, search = '' }: { board: AdminBidBoard; search?: string }) {
  const needle = search.trim().toLowerCase();
  const visible = board.seats.filter((seat) =>
    [
      seat.station,
      seat.unit,
      seat.position,
      seat.rank,
      'occupant' in seat ? seat.occupant?.name : null,
      'award' in seat ? seat.award?.name : null,
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
  const stations = [...new Set(visible.map((seat) => seat.station))];
  return (
    <div
      className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      data-testid="board-stations"
    >
      {stations.length === 0 && (
        <p className="col-span-full rounded-lg border border-border bg-card p-5 text-muted-foreground">
          No seats in this view and selection.
        </p>
      )}
      {stations.map((station) => (
        <StationRosterCard
          key={`${board.view}:${station ?? 'unmapped'}`}
          station={station}
          seats={visible.filter((seat) => seat.station === station)}
          searching={Boolean(needle)}
        />
      ))}
    </div>
  );
}
