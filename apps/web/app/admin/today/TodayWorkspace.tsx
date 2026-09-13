'use client';

import { ShiftBadge } from '@/components/admin/RosterIdentity';
import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { formatET } from '@/lib/et-time';
import type { DepartmentRosterProjection } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RosterCard } from './RosterCards';
import { groupRoster } from './roster-pagination';
import { useRosterLayout } from './use-roster-layout';

async function readRoster(asOf: string, signal: AbortSignal): Promise<DepartmentRosterProjection> {
  const response = await fetch(
    `/api/admin/department/current-roster?${new URLSearchParams({ as_of: asOf })}`,
    { credentials: 'include', cache: 'no-store', signal },
  );
  if (!response.ok) throw new Error(`Staffing could not be loaded (${response.status}).`);
  const data = (await response.json()) as DepartmentRosterProjection;
  if (!Array.isArray(data.positions) || !Array.isArray(data.unassignedMembers) || !data.summary) {
    throw new Error('The staffing service returned an incomplete roster.');
  }
  return data;
}

function shiftLabel(shift: string) {
  return shift === 'D'
    ? 'D / Days'
    : /^[A-Z]$/.test(shift)
      ? `${shift} Shift`
      : shift || 'Shift not specified';
}

export function TodayWorkspace({ initialDate }: { initialDate: string }) {
  const [asOf, setAsOf] = useState(initialDate);
  const [selectedShift, setSelectedShift] = useState<string | null>(null);
  const [vacanciesOnly, setVacanciesOnly] = useState(false);
  const [panel, setPanel] = useState<'organization' | 'unassigned' | null>(null);
  const [detailPositionId, setDetailPositionId] = useState<string | null>(null);
  const roster = useQuery({
    queryKey: ['admin', 'department', 'current-roster', asOf],
    queryFn: ({ signal }) => readRoster(asOf, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const data = roster.data;
  const shifts = useMemo(
    () => [...new Set((data?.positions ?? []).map((position) => position.shift ?? ''))],
    [data?.positions],
  );
  const activeShift =
    selectedShift !== null && shifts.includes(selectedShift) ? selectedShift : (shifts[0] ?? '');
  const shiftPositions = useMemo(
    () => (data?.positions ?? []).filter((position) => (position.shift ?? '') === activeShift),
    [data?.positions, activeShift],
  );
  const vacant = shiftPositions.filter((position) => position.occupancy === 'vacant').length;
  const groups = useMemo(
    () =>
      groupRoster(
        vacanciesOnly ? shiftPositions.filter((p) => p.occupancy === 'vacant') : shiftPositions,
      ),
    [shiftPositions, vacanciesOnly],
  );
  const layout = useRosterLayout(groups);
  const selection = JSON.stringify([
    asOf,
    activeShift,
    vacanciesOnly,
    layout.columnWidth,
    layout.geometry.height,
    groups.map((group) => group.positions.map((position) => position.id)),
  ]);
  const [cursor, setCursor] = useState({ selection: '', page: 0 });
  const pageCount = Math.max(1, layout.pages.length);
  const currentPage = cursor.selection === selection ? Math.min(cursor.page, pageCount - 1) : 0;
  const page = layout.pages[currentPage];
  const sourceUpdated = data?.updatedAt == null ? null : new Date(data.updatedAt);
  const validUpdated =
    sourceUpdated && Number.isFinite(sourceUpdated.getTime()) ? sourceUpdated : null;
  const organization = data?.organizationUnits ?? [];
  const detailPosition = data?.positions.find((position) => position.id === detailPositionId);
  const detailGroup = detailPosition ? groupRoster([detailPosition])[0] : undefined;

  return (
    <section
      data-testid="today-workspace"
      data-layout-ready={layout.ready}
      className="mx-auto flex min-w-0 max-w-[120rem] flex-col gap-3 lg:h-full lg:min-h-0"
      aria-labelledby="today-heading"
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="today-heading" className="font-heading text-2xl font-bold tracking-tight">
            Today
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Department staffing by date and shift.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs leading-5 text-muted-foreground">
            Latest recorded change{' '}
            {validUpdated ? (
              <time
                dateTime={validUpdated.toISOString()}
                className="block font-medium text-foreground"
              >
                {formatET(validUpdated, 'datetime')} ET
              </time>
            ) : (
              <span className="block">{roster.isPending ? 'Loading…' : 'Time unavailable'}</span>
            )}
            <span className="block">
              {roster.dataUpdatedAt
                ? `Refreshed ${formatET(new Date(roster.dataUpdatedAt), 'time')} ET`
                : 'Roster not loaded yet'}
            </span>
          </p>
          <Button
            type="button"
            onClick={() => void roster.refetch()}
            disabled={roster.isFetching}
            aria-label="Refresh staffing"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {roster.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <Label className="grid gap-1 text-xs">
          Staffing date
          <Input
            type="date"
            value={asOf}
            onChange={(event) => {
              if (event.target.value) setAsOf(event.target.value);
            }}
            className="min-h-11 w-40 text-sm"
          />
        </Label>
        <Label className="grid gap-1 text-xs">
          Shift
          <NativeSelect
            value={activeShift}
            onChange={(event) => setSelectedShift(event.target.value)}
            disabled={shifts.length === 0}
            className="min-h-11 w-40 max-w-full text-sm"
          >
            {shifts.length === 0 && <option value="">No shifts available</option>}
            {shifts.map((shift) => (
              <option key={shift} value={shift}>
                {shiftLabel(shift)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button
          type="button"
          aria-pressed={vacanciesOnly}
          onClick={() => setVacanciesOnly((value) => !value)}
          disabled={!data}
        >
          {vacanciesOnly ? 'Show all positions' : 'Vacancies only'}
        </Button>
        <Button type="button" onClick={() => setPanel('organization')} disabled={!data}>
          Organization
        </Button>
        <Button type="button" onClick={() => setPanel('unassigned')} disabled={!data}>
          {data ? `Unassigned (${data.unassignedMembers.length})` : 'Unassigned members'}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-sidebar px-4 py-3 text-sidebar-foreground">
        {data && shifts.length > 0 ? (
          <ShiftBadge shift={activeShift || null} />
        ) : (
          <span className="text-sm">
            {roster.isPending
              ? 'Loading shifts…'
              : data
                ? 'No shift positions'
                : 'Shift unavailable'}
          </span>
        )}
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt>Positions</dt>
            <dd className="font-heading text-lg font-semibold tabular-nums">
              {data ? shiftPositions.length : 'Unavailable'}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt>Occupied</dt>
            <dd className="font-heading text-lg font-semibold tabular-nums">
              {data ? shiftPositions.length - vacant : 'Unavailable'}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt>Vacant</dt>
            <dd className="font-heading text-lg font-semibold tabular-nums">
              {data ? vacant : 'Unavailable'}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-sidebar-muted">Staffing as of {data?.asOf ?? asOf}</p>
      </div>

      {roster.isError && (
        <div
          role="alert"
          className="shrink-0 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning"
        >
          {data
            ? `Refresh failed. Showing the roster loaded at ${formatET(new Date(roster.dataUpdatedAt), 'time')} ET. `
            : 'Current staffing is unavailable. '}
          {roster.error.message} Use Refresh to retry.
        </div>
      )}

      <div
        ref={layout.rosterRef}
        data-testid="today-roster"
        aria-label={`${shiftLabel(activeShift)} staffing`}
        aria-busy={roster.isPending || !layout.ready}
        className="min-w-0 lg:min-h-0 lg:flex-1"
      >
        {roster.isPending ? (
          <output className="block rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            Loading current staffing…
          </output>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5 text-sm">
            <p className="font-semibold">
              {roster.isError
                ? 'Staffing could not be loaded'
                : vacanciesOnly
                  ? 'No vacant positions in this shift'
                  : 'No reviewed staffing positions for this date'}
            </p>
            {!vacanciesOnly && (
              <p className="mt-2 text-muted-foreground">
                Use Organization to review configured stations and units, including those without
                linked positions.
              </p>
            )}
          </div>
        ) : !layout.ready ? (
          <output className="block p-4 text-sm text-muted-foreground">
            Arranging the complete roster…
          </output>
        ) : (
          <div
            className="grid items-start gap-3"
            style={{
              gridTemplateColumns: `repeat(${layout.geometry.desktop ? layout.columns : 1}, minmax(0, 1fr))`,
            }}
          >
            {page
              ?.filter((column) => column.length > 0)
              .map((column) => (
                <div key={column[0]?.positions[0]?.id} className="flex min-w-0 flex-col gap-3">
                  {column.map((fragment) => (
                    <RosterCard
                      key={`${fragment.group.id}:${fragment.positions[0]?.id}`}
                      group={fragment.group}
                      positions={fragment.positions}
                      compactPositionIds={layout.compactPositionIds}
                      onOpenPosition={(position) => setDetailPositionId(position.id)}
                    />
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>

      <nav
        aria-label="Roster pages"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm"
      >
        <output aria-live="polite" className="text-muted-foreground">
          {data
            ? `Page ${currentPage + 1} of ${pageCount} · ${vacanciesOnly ? vacant : shiftPositions.length} positions`
            : roster.isPending
              ? 'Roster loading…'
              : 'Roster unavailable'}
        </output>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            aria-label="Previous roster page"
            disabled={currentPage === 0 || !layout.ready}
            onClick={() => setCursor({ selection, page: currentPage - 1 })}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Previous
          </Button>
          <Button
            type="button"
            aria-label="Next roster page"
            disabled={currentPage + 1 >= pageCount || !layout.ready}
            onClick={() => setCursor({ selection, page: currentPage + 1 })}
          >
            Next <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </nav>

      <div
        ref={layout.measurementRef}
        aria-hidden="true"
        inert
        className="pointer-events-none invisible fixed top-0"
        style={{ left: -100000, width: layout.columnWidth }}
      >
        {groups.map((group) => (
          <RosterCard key={group.id} group={group} positions={group.positions} measuring />
        ))}
        {groups.map((group) => (
          <RosterCard
            key={`compact:${group.id}`}
            group={group}
            positions={group.positions}
            compactPositionIds={group.positions.map((position) => position.id)}
            measuring
          />
        ))}
      </div>

      <TaskPanel
        open={Boolean(detailPosition && detailGroup)}
        onClose={() => setDetailPositionId(null)}
        title="Staffing record details"
        description={`Complete position, member and temporary assignment context for ${data?.asOf ?? asOf}.`}
      >
        {detailPosition && detailGroup && (
          <RosterCard group={detailGroup} positions={[detailPosition]} />
        )}
      </TaskPanel>

      <TaskPanel
        open={panel === 'organization'}
        onClose={() => setPanel(null)}
        title="Department organization"
        description={`Configured locations and groups for ${shiftLabel(activeShift)} on ${data?.asOf ?? asOf}.`}
      >
        {organization.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No organization configuration was returned. The roster retains its source location
            labels.
          </p>
        ) : (
          <ul className="space-y-3">
            {organization.map((unit) => {
              const linked = shiftPositions.filter(
                (position) =>
                  position.organization && Object.values(position.organization).includes(unit.id),
              ).length;
              return (
                <li key={unit.id} className="rounded-lg border border-border p-3 text-sm">
                  <h3 className="break-words font-semibold">{unit.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {unit.kind === 'APPARATUS'
                      ? 'Apparatus'
                      : unit.kind === 'STATION'
                        ? 'Station'
                        : 'Group'}{' '}
                    · {unit.status}
                  </p>
                  <p className="mt-2">
                    {linked
                      ? `${linked} staffing positions linked for this shift`
                      : 'No staffing positions linked for this shift'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href={'/admin/organization' as Route}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline"
        >
          Manage organization
        </Link>
      </TaskPanel>
      <TaskPanel
        open={panel === 'unassigned'}
        onClose={() => setPanel(null)}
        title="Unassigned department members"
        description={`Members without an active or planned staffing position on ${data?.asOf ?? asOf}. This list covers the department.`}
      >
        {data?.unassignedMembers.length ? (
          <ul className="divide-y divide-border">
            {data.unassignedMembers.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-semibold">
                    {member.firstName} {member.lastName}
                  </p>
                  <p className="text-muted-foreground">{member.rank}</p>
                </div>
                <Link
                  href={`/admin/members/${member.id}` as Route}
                  className="inline-flex min-h-11 items-center font-semibold underline"
                >
                  Open member
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No unassigned department members on this date.</p>
        )}
      </TaskPanel>
    </section>
  );
}
