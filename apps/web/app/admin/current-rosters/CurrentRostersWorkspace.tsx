'use client';
import { ListPagination, useListPage } from '@/components/admin/ListPagination';
import { UnitBadge, rosterTone, shiftTone } from '@/components/admin/RosterIdentity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

export interface CurrentRosterPosition {
  id: string;
  stableSlotKey: string;
  division: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  positionName: string | null;
  applicableRank: string | null;
  occupancy: 'occupied' | 'vacant';
  administrativeAssignment: boolean;
  assignment: {
    id: string;
    memberId: number;
    originType: string | null;
    status: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  } | null;
  member: {
    id: number;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    rank: string | null;
  } | null;
}

export interface CurrentRosterResponse {
  asOf: string;
  administrativeAssignmentPolicy: {
    status: 'configured' | 'unconfigured';
    bidYear: number;
    ruleBookVersion: string | null;
  };
  positions: CurrentRosterPosition[];
  summary: {
    totalPositions: number;
    occupiedPositions: number;
    vacantPositions: number;
    administrativelyAssignedNonBiddablePositions: number;
  };
  unassignedMembers: Array<{
    id: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: string;
    bidCategory: string;
  }>;
}

const SHIFT_LABELS: Readonly<Record<string, string>> = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  D: 'D / Days',
};

function display(value: string | null): string {
  return value === null || value.trim().length === 0 ? 'Not specified' : value;
}

function memberName(position: CurrentRosterPosition): string {
  if (position.member === null) return 'Vacant';
  return `${display(position.member.firstName)} ${display(position.member.lastName)}`;
}

function rowsForShift(positions: readonly CurrentRosterPosition[], shift: string) {
  return positions.filter((position) => position.shift === shift);
}

function RosterTable({ positions }: { positions: readonly CurrentRosterPosition[] }) {
  const page = useListPage([...positions], positions.map((p) => p.id).join(':'), 6);
  return (
    <div>
      <div className="max-h-[50dvh] overflow-auto overscroll-contain">
        <Table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm [&_td]:break-words">
          <TableHeader className="text-xs uppercase tracking-wide text-muted-foreground">
            <TableRow>
              <TableHead className="border-b border-border px-3 py-3 font-semibold">
                Location
              </TableHead>
              <TableHead className="border-b border-border px-3 py-3 font-semibold">Seat</TableHead>
              <TableHead className="border-b border-border px-3 py-3 font-semibold">
                Member
              </TableHead>
              <TableHead className="border-b border-border px-3 py-3 font-semibold">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-800">
            {page.rows.map((position) => (
              <TableRow key={position.id} className="align-top text-foreground">
                <TableCell className="px-3 py-3">
                  <p className="font-medium text-foreground">Station {display(position.station)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <UnitBadge unit={position.unit} /> · {display(position.division)}
                  </p>
                </TableCell>
                <TableCell className="px-3 py-3">
                  <p className="font-medium text-foreground">{display(position.positionName)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Required rank: {display(position.applicableRank)}
                  </p>
                </TableCell>
                <TableCell className="px-3 py-3">
                  <p
                    className={
                      position.member === null ? 'font-medium text-warning' : 'font-medium'
                    }
                  >
                    {memberName(position)}
                  </p>
                  {position.member !== null && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {display(position.member.rank)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="px-3 py-3">
                  <span
                    className={
                      position.occupancy === 'occupied'
                        ? 'inline-flex rounded-full bg-success-surface px-2 py-1 text-xs font-semibold text-success'
                        : 'inline-flex rounded-full bg-warning-surface px-2 py-1 text-xs font-semibold text-warning'
                    }
                  >
                    {position.occupancy === 'occupied' ? 'Occupied' : 'Vacant'}
                  </span>
                  {position.administrativeAssignment && (
                    <p className="mt-1 max-w-44 text-xs font-medium text-info">
                      Administratively assigned · non-biddable
                    </p>
                  )}
                  {position.assignment !== null && (
                    <div className="mt-1 max-w-52 text-xs text-muted-foreground">
                      <p>
                        {position.assignment.status ?? 'assignment'} · effective{' '}
                        {position.assignment.effectiveFrom ?? 'unspecified'}
                        {position.assignment.effectiveTo === null
                          ? ' onward'
                          : ` through ${position.assignment.effectiveTo}`}
                      </p>
                      <Link
                        href={
                          `/admin/personnel?memberId=${position.assignment.memberId}&assignmentId=${position.assignment.id}` as Route
                        }
                        className="mt-1 inline-flex min-h-8 items-center font-medium text-destructive hover:text-destructive"
                      >
                        Assignment history
                      </Link>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ListPagination {...page} label="positions" />
    </div>
  );
}

export function CurrentRostersWorkspace({
  roster,
  filters = {},
}: {
  roster: CurrentRosterResponse;
  filters?: Record<string, string>;
}) {
  const hasProjectedRoster = roster.positions.length > 0;
  const [selectedShift, setSelectedShift] = useState(filters.shift || 'A');
  const availableShifts = ['A', 'B', 'C', 'D'].filter((shift) =>
    roster.positions.some((p) => p.shift === shift),
  );
  const activeShift = availableShifts.includes(selectedShift) ? selectedShift : availableShifts[0];
  const unassignedPage = useListPage(roster.unassignedMembers, roster.asOf, 12);
  const query = new URLSearchParams({ as_of: roster.asOf, ...filters }).toString();

  return (
    <section className="space-y-7" aria-labelledby="current-rosters-heading">
      <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Staffing projection · as of {roster.asOf}
          </p>
          <h1 id="current-rosters-heading" className="mt-1 font-heading text-2xl text-foreground">
            Current Rosters
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-foreground">
            Operational staffing capacity and current occupancy are shown separately. A vacancy is a
            staffing condition, not a Bid opportunity.
          </p>
        </div>
        <Link
          href={'/admin/personnel' as Route}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-destructive/40 bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-destructive focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Record personnel change
        </Link>
      </header>

      <form
        method="get"
        action="/admin/current-rosters"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <Label className="block">
          <span className="text-sm font-medium text-foreground">View staffing date</span>
          <Input
            type="date"
            name="as_of"
            defaultValue={roster.asOf}
            className="mt-1 block min-h-11 rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Shift</span>
          <NativeSelect
            name="shift"
            defaultValue={filters.shift ?? ''}
            className="mt-1 block min-h-11 rounded border border-border bg-card px-3 py-2 text-foreground"
          >
            <option value="">All shifts</option>
            <option value="A">A Shift</option>
            <option value="B">B Shift</option>
            <option value="C">C Shift</option>
            <option value="D">D / Days</option>
          </NativeSelect>
        </Label>
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Station</span>
          <Input
            name="station"
            defaultValue={filters.station ?? ''}
            className="mt-1 block min-h-11 w-28 rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Division</span>
          <Input
            name="division"
            defaultValue={filters.division ?? ''}
            className="mt-1 block min-h-11 w-36 rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Unit</span>
          <Input
            name="unit"
            defaultValue={filters.unit ?? ''}
            className="mt-1 block min-h-11 w-36 rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Rank</span>
          <Input
            name="rank"
            defaultValue={filters.rank ?? ''}
            className="mt-1 block min-h-11 w-24 rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <Button
          type="submit"
          className="min-h-11 rounded border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-border"
        >
          View date
        </Button>
        <p className="pb-2 text-xs text-muted-foreground">
          Future dates show planned assignments; prior dates preserve reviewed history.
        </p>
        <a
          href={`/api/admin/current-roster/export.csv?${query}`}
          className="inline-flex min-h-11 items-center rounded border border-info/40 px-4 py-2 text-sm font-semibold text-info hover:border-info/40 hover:text-foreground"
        >
          Download roster CSV
        </a>
        <Link
          href={`/admin/current-rosters/print?${query}` as Route}
          className="inline-flex min-h-11 items-center rounded border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-border"
        >
          Printable roster
        </Link>
      </form>

      <section aria-labelledby="roster-summary-heading">
        <h2 id="roster-summary-heading" className="font-heading text-lg text-foreground">
          Roster at a glance
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Authorized seats</dt>
            <dd className="mt-1 text-xl font-semibold text-foreground">
              {roster.summary.totalPositions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Occupied</dt>
            <dd className="mt-1 text-xl font-semibold text-success">
              {roster.summary.occupiedPositions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Vacant</dt>
            <dd className="mt-1 text-xl font-semibold text-warning">
              {roster.summary.vacantPositions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Administratively assigned</dt>
            <dd className="mt-1 text-xl font-semibold text-info">
              {roster.summary.administrativelyAssignedNonBiddablePositions}
            </dd>
          </div>
        </dl>
      </section>

      {!hasProjectedRoster ? (
        <section className="border border-warning/40 bg-warning-surface px-4 py-5 text-sm text-warning">
          <h2 className="font-semibold">No reviewed staffing projection is available yet</h2>
          <p className="mt-1 max-w-3xl text-warning">
            Complete the TeleStaff review and mapping workflow before treating this view as a
            staffing baseline. No position or Bid opportunity is created by this screen.
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          <nav aria-label="Roster shifts" className="flex flex-wrap gap-2">
            {availableShifts.map((shift) => (
              <Button
                key={shift}
                type="button"
                variant="secondary"
                className={`${rosterTone({ tone: shiftTone(shift) })} ${activeShift === shift ? 'ring-2 ring-ring ring-offset-2' : ''}`}
                aria-pressed={activeShift === shift}
                onClick={() => setSelectedShift(shift)}
              >
                {SHIFT_LABELS[shift]} ({rowsForShift(roster.positions, shift).length})
              </Button>
            ))}
          </nav>
          {availableShifts
            .filter((shift) => shift === activeShift)
            .map((shift) => {
              const positions = rowsForShift(roster.positions, shift);
              if (positions.length === 0) return null;
              return (
                <section key={shift} aria-labelledby={`roster-${shift}-heading`}>
                  <div
                    className={`flex items-baseline justify-between gap-4 rounded-md border px-3 py-2 ${rosterTone({ tone: shiftTone(shift) })}`}
                  >
                    <h2 id={`roster-${shift}-heading`} className="font-heading text-lg">
                      {SHIFT_LABELS[shift]}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {positions.length} authorized seat{positions.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <RosterTable positions={positions} />
                </section>
              );
            })}
        </div>
      )}

      <details className="border-t border-border pt-3">
        <summary
          id="unassigned-heading"
          className="cursor-pointer font-heading text-lg text-foreground"
        >
          Unassigned members ({roster.unassignedMembers.length})
        </summary>
        <p className="mt-1 text-sm text-muted-foreground">
          Members shown here are not currently placed in an authorized active or planned seat.
        </p>
        {roster.unassignedMembers.length === 0 ? (
          <p className="mt-3 text-sm text-foreground">
            No active or unclassified members are unassigned.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unassignedPage.rows.map((member) => (
              <li key={member.id} className="border-l border-border pl-3 text-sm text-foreground">
                <span className="font-medium text-foreground">
                  {member.firstName} {member.lastName}
                </span>
                <span className="ml-2 text-muted-foreground">{member.rank}</span>
              </li>
            ))}
          </ul>
        )}
        <ListPagination {...unassignedPage} label="unassigned members" />
      </details>

      {roster.administrativeAssignmentPolicy.status === 'unconfigured' && (
        <p className="border-l-2 border-warning/40 pl-3 text-sm text-warning">
          The {roster.administrativeAssignmentPolicy.bidYear} policy book is not designated. This
          roster therefore makes no claim about annual Bid participation.
        </p>
      )}
    </section>
  );
}
