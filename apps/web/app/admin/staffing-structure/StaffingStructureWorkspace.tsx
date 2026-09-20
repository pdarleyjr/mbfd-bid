'use client';
import { TaskPanel } from '@/components/admin/TaskPanel';
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
import { Textarea } from '@/components/ui/textarea';
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';
import { useRetainedMutation } from '@/lib/use-retained-mutation';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type { DepartmentRetirementImpact, DepartmentRosterPosition } from '@mbfd/shared';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import type { CurrentRosterResponse } from '../current-rosters/CurrentRostersWorkspace';

type StaffingPosition = Pick<
  DepartmentRosterPosition,
  | 'id'
  | 'stableSlotKey'
  | 'division'
  | 'shift'
  | 'station'
  | 'unit'
  | 'positionName'
  | 'applicableRank'
  | 'occupancy'
  | 'assignment'
  | 'member'
> & { administrativeAssignment?: boolean };

/** Department and legacy readers supply their actual common projection fields. */
export interface StaffingStructureRoster {
  asOf: string;
  positions: StaffingPosition[];
  summary: { totalPositions: number; occupiedPositions: number; vacantPositions: number };
}

const rankOptions = ['FF', 'LT', 'CPT', 'DC'] as const;

function keyPart(value: string | undefined) {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function slotKey(input: Record<string, string>) {
  return [input.shift, input.station, input.unit, input.position_name, input.seat]
    .map(keyPart)
    .filter(Boolean)
    .join('/');
}

function errorText(value: unknown) {
  return typeof value === 'object' && value !== null && 'error' in value
    ? String((value as { error: unknown }).error).replaceAll('_', ' ')
    : 'The staffing lifecycle command was not accepted.';
}

export function StaffingStructureWorkspace({
  roster,
  showProjectionDateControl = true,
  onMutationLocked,
}: {
  roster: StaffingStructureRoster | CurrentRosterResponse;
  showProjectionDateControl?: boolean;
  onMutationLocked?: (locked: boolean) => void;
}) {
  const refreshProjections = usePersonnelProjectionRefresh();
  const mutation = useRetainedMutation<Record<string, unknown>>('staffing-position');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    division: '',
    shift: roster.positions.find((position) => position.shift)?.shift ?? 'A',
    station: '',
    unit: '',
    position_name: '',
    applicable_rank: 'FF',
    seat: '1',
    effective_on: roster.asOf,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [creationBaseline, setCreationBaseline] = useState(form);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retirement, setRetirement] = useState<{
    position: StaffingPosition;
    effectiveOn: string;
    reason: string;
  } | null>(null);
  const [retirementOpen, setRetirementOpen] = useState(false);
  const [preview, setPreview] = useState<{
    fingerprint: string;
    impact: DepartmentRetirementImpact;
  } | null>(null);
  const [retirementError, setRetirementError] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<{
    kind: 'create' | 'retire';
    request: ReturnType<typeof mutation.prepare>;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const locked = busy || uncertain;
  const creationDirty = JSON.stringify(form) !== JSON.stringify(creationBaseline);
  const navigationLocked = locked || creationDirty || retirement !== null;
  const shiftListId = useId();
  const Heading = showProjectionDateControl ? 'h1' : 'h2';
  const shifts = [
    ...new Set(roster.positions.flatMap((position) => (position.shift ? [position.shift] : []))),
  ];
  useUnsavedChanges(navigationLocked, 'staffing changes');
  useEffect(() => {
    onMutationLocked?.(navigationLocked);
  }, [navigationLocked, onMutationLocked]);
  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      roster.positions.filter((position) =>
        query.length === 0
          ? true
          : [
              position.stableSlotKey,
              position.division,
              position.shift,
              position.station,
              position.unit,
              position.positionName,
              position.applicableRank,
            ]
              .filter((value): value is string => value !== null)
              .join(' ')
              .toLowerCase()
              .includes(query),
      ),
    [query, roster.positions],
  );
  const canonicalKey = slotKey(form);

  function update(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function command(request: ReturnType<typeof mutation.prepare>, kind: 'create' | 'retire') {
    setPendingCommand({ request, kind });
    let definitelyRejected = false;
    try {
      const response = await createCsrfAwareFetch(fetch, () => window.location.origin)(
        '/api/admin/personnel/changes',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key },
          body: JSON.stringify(request.payload),
        },
      );
      const body = (await response.json()) as {
        error?: string;
        replayed?: boolean;
        event?: { id?: string; kind?: string };
      };
      if (!response.ok) {
        definitelyRejected =
          !uncertain &&
          response.status >= 400 &&
          response.status < 500 &&
          typeof body.error === 'string';
        throw new Error(errorText(body));
      }
      if (
        typeof body.replayed !== 'boolean' ||
        typeof body.event?.id !== 'string' ||
        body.event.id.trim().length === 0 ||
        body.event.kind !== request.payload.kind
      ) {
        throw new Error('The response did not include the expected lifecycle receipt.');
      }
      mutation.accepted(request.key);
      setPendingCommand(null);
      setUncertain(false);
    } catch (caught) {
      setUncertain(!definitelyRejected);
      if (definitelyRejected) {
        setPendingCommand(null);
        if (kind === 'retire') setPreview(null);
      }
      const detail =
        caught instanceof Error ? caught.message : 'The staffing service could not be reached.';
      throw new Error(
        definitelyRejected
          ? detail
          : `${detail} The result is unconfirmed. Retry the same request to retrieve its receipt.`,
      );
    }
  }

  async function refreshAfterReceipt() {
    try {
      await refreshProjections();
    } catch {
      setNotice(
        (current) =>
          `${current ?? 'The change was recorded.'} Refresh did not finish; reload the roster to view the recorded change.`,
      );
    }
  }

  async function createPosition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (uncertain && pendingCommand?.kind !== 'create')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const request =
        uncertain && pendingCommand?.kind === 'create'
          ? pendingCommand.request
          : mutation.prepare(JSON.stringify({ operation: 'create', form }), () => ({
              kind: 'POSITION_CREATE',
              effective_on: form.effective_on,
              reason: form.reason,
              staffing_position: {
                id: `admin-${crypto.randomUUID()}`,
                stable_slot_key: canonicalKey,
                division: form.division || null,
                shift: form.shift,
                station: form.station || null,
                unit: form.unit || null,
                position_name: form.position_name || null,
                applicable_rank: form.applicable_rank,
                active_from: form.effective_on,
                review_status: 'approved',
              },
            }));
      await command(request, 'create');
      setNotice('Authorized staffing seat created. Effective-dated projections are refreshing.');
      const next = { ...form, position_name: '', seat: '1', reason: '' };
      setForm(next);
      setCreationBaseline(next);
      await refreshAfterReceipt();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The staffing seat was not created.');
    } finally {
      setBusy(false);
    }
  }

  function retirePosition(position: StaffingPosition) {
    if (locked) return;
    setRetirement({ position, effectiveOn: form.effective_on, reason: '' });
    setRetirementOpen(true);
    setPreview(null);
    setRetirementError(null);
  }

  function retirementPayload() {
    return retirement
      ? {
          kind: 'POSITION_RETIRE',
          effective_on: retirement.effectiveOn,
          reason: retirement.reason.trim(),
          staffing_position_id: retirement.position.id,
        }
      : null;
  }
  const currentRetirementPayload = retirementPayload();
  const currentPreview =
    preview?.fingerprint === JSON.stringify(currentRetirementPayload) ? preview.impact : null;

  async function previewRetirement() {
    const payload = retirementPayload();
    if (!payload || locked || payload.reason.length < 4 || !payload.effective_on) return;
    setBusy(true);
    setPreview(null);
    setRetirementError(null);
    try {
      const response = await createCsrfAwareFetch(fetch, () => window.location.origin)(
        '/api/admin/personnel/changes/preview',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as {
        preview?: boolean;
        impact?: DepartmentRetirementImpact;
        error?: string;
      };
      if (!response.ok) throw new Error(errorText(body));
      const impact = body.impact;
      if (
        body.preview !== true ||
        !impact ||
        impact.target?.kind !== 'POSITION' ||
        impact.target.id !== payload.staffing_position_id ||
        impact.effectiveOn !== payload.effective_on ||
        typeof impact.retirementBlocked !== 'boolean' ||
        impact.retainsHistory !== true ||
        !Array.isArray(impact.blockers) ||
        !Array.isArray(impact.assignments) ||
        !Array.isArray(impact.organizationVersions) ||
        !Array.isArray(impact.organizationLinks)
      ) {
        throw new Error(
          'The service did not return a complete preview for this position and date.',
        );
      }
      setPreview({ fingerprint: JSON.stringify(payload), impact });
    } catch (caught) {
      setRetirementError(
        caught instanceof Error ? caught.message : 'The retirement preview could not be loaded.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmRetirement() {
    const payload = retirementPayload();
    if (!payload || busy || (uncertain && pendingCommand?.kind !== 'retire')) return;
    if (
      !uncertain &&
      (!currentPreview || currentPreview.retirementBlocked || currentPreview.blockers.length > 0)
    )
      return;
    setBusy(true);
    setRetirementError(null);
    try {
      const request =
        uncertain && pendingCommand?.kind === 'retire'
          ? pendingCommand.request
          : mutation.prepare(JSON.stringify(payload), () => payload);
      await command(request, 'retire');
      setNotice(
        'Position retired through the effective-dated lifecycle. Updated projections are refreshing.',
      );
      setRetirementOpen(false);
      setRetirement(null);
      setPreview(null);
      await refreshAfterReceipt();
    } catch (caught) {
      setRetirementError(
        caught instanceof Error ? caught.message : 'The retirement request was not confirmed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="staffing-structure-heading">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
            Authorized capacity
          </p>
          <Heading
            id="staffing-structure-heading"
            className="mt-1 font-heading text-3xl text-foreground"
          >
            {showProjectionDateControl ? 'Staffing Structure' : 'Positions and assignments'}
          </Heading>
          <p className="mt-2 max-w-3xl text-sm text-foreground">
            Create effective-dated authorized seats, review capacity and occupancy, and retire
            vacant capacity without destroying historical assignments. Review Bid participation
            separately.
          </p>
        </div>
        <Link
          href={`/admin/department?as_of=${roster.asOf}` as Route}
          className="inline-flex min-h-11 items-center rounded border border-destructive/40 bg-destructive px-4 text-sm font-semibold text-primary-foreground hover:bg-destructive"
        >
          Move or reassign a member
        </Link>
      </header>

      <form
        onSubmit={(event) => void createPosition(event)}
        className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-3"
      >
        <fieldset disabled={locked} className="contents">
          <div className="md:col-span-3">
            <h2 className="font-heading text-xl text-foreground">Add authorized position</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record reviewed capacity using the actual shift, location and position details.
            </p>
          </div>
          <Label>
            <span className="text-sm text-foreground">Shift</span>
            <Input
              required
              maxLength={32}
              list={shiftListId}
              value={form.shift}
              onChange={(e) => update('shift', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
            <datalist id={shiftListId}>
              {shifts.map((shift) => (
                <option key={shift} value={shift} />
              ))}
            </datalist>
          </Label>
          <Label>
            <span className="text-sm text-foreground">Station</span>
            <Input
              required
              maxLength={128}
              value={form.station}
              onChange={(e) => update('station', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label>
            <span className="text-sm text-foreground">Unit</span>
            <Input
              required
              maxLength={128}
              value={form.unit}
              onChange={(e) => update('unit', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label>
            <span className="text-sm text-foreground">Division</span>
            <Input
              maxLength={128}
              value={form.division}
              onChange={(e) => update('division', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label>
            <span className="text-sm text-foreground">Position</span>
            <Input
              required
              maxLength={256}
              value={form.position_name}
              onChange={(e) => update('position_name', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label>
            <span className="text-sm text-foreground">Applicable rank</span>
            <NativeSelect
              value={form.applicable_rank}
              onChange={(e) => update('applicable_rank', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            >
              {rankOptions.map((rank) => (
                <option key={rank}>{rank}</option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            <span className="text-sm text-foreground">Seat number</span>
            <Input
              required
              value={form.seat}
              onChange={(e) => update('seat', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label>
            <span className="text-sm text-foreground">Effective date</span>
            <Input
              required
              type="date"
              value={form.effective_on}
              onChange={(e) => update('effective_on', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label className="md:col-span-2">
            <span className="text-sm text-foreground">Reason</span>
            <Input
              required
              minLength={4}
              value={form.reason}
              onChange={(e) => update('reason', e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <p className="rounded border border-info/40 bg-info-surface px-3 py-2 text-xs text-info md:col-span-3">
            Reviewable canonical key:{' '}
            <span className="font-mono">{canonicalKey || 'Complete the operational fields'}</span>
          </p>
        </fieldset>
        <Button
          disabled={
            busy ||
            canonicalKey.length === 0 ||
            canonicalKey.length > 256 ||
            (uncertain && pendingCommand?.kind !== 'create')
          }
          type="submit"
          className="min-h-11 w-fit rounded bg-destructive px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Recording…' : 'Create authorized seat'}
        </Button>
        <Button
          type="button"
          disabled={locked || !creationDirty}
          onClick={() => {
            setForm(creationBaseline);
            setError(null);
          }}
        >
          Clear position draft
        </Button>
      </form>
      {uncertain && (
        <div
          role="alert"
          className="rounded border border-warning/40 bg-warning-surface p-4 text-sm text-warning"
        >
          A staffing request has no confirmed receipt. Its fields are locked to preserve the
          original request.
          {pendingCommand?.kind === 'create' ? (
            ' Use Create authorized seat to retry the same request.'
          ) : (
            <Button type="button" onClick={() => setRetirementOpen(true)} className="mt-2">
              Review unconfirmed retirement
            </Button>
          )}
        </div>
      )}
      {error !== null && (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive-surface px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <output className="block rounded border border-success/40 bg-success-surface px-4 py-3 text-sm text-success">
          {notice}
        </output>
      )}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl text-foreground">Capacity and occupancy</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              As of {roster.asOf}: {roster.summary.totalPositions} seats,{' '}
              {roster.summary.occupiedPositions} occupied, {roster.summary.vacantPositions} vacant.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {showProjectionDateControl && (
              <form
                action="/admin/staffing-structure"
                method="get"
                className="flex items-end gap-2"
              >
                <Label className="block">
                  <span className="text-sm text-foreground">Projection date</span>
                  <Input
                    type="date"
                    disabled={navigationLocked}
                    name="as_of"
                    defaultValue={roster.asOf}
                    className="mt-1 min-h-11 rounded border border-border bg-card px-3 text-foreground"
                  />
                </Label>
                <Button
                  type="submit"
                  disabled={navigationLocked}
                  className="min-h-11 rounded border border-border px-3 text-sm text-foreground hover:bg-muted"
                >
                  View projection
                </Button>
              </form>
            )}
            <Label className="block">
              <span className="text-sm text-foreground">Search position</span>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mt-1 min-h-11 rounded border border-border bg-card px-3 text-foreground"
              />
            </Label>
          </div>
        </div>
        <div className="relative mt-4 overflow-x-auto">
          <Table className="w-full min-w-[54rem] text-left text-sm">
            <TableHeader className="text-xs uppercase tracking-wide text-muted-foreground">
              <TableRow>
                <TableHead className="px-3 py-2">Shift / station</TableHead>
                <TableHead className="px-3 py-2">Unit / seat</TableHead>
                <TableHead className="px-3 py-2">Occupant</TableHead>
                <TableHead className="px-3 py-2">Status</TableHead>
                <TableHead className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-700">
              {visible.map((position) => (
                <TableRow key={position.id}>
                  <TableCell className="px-3 py-3 text-foreground">
                    {position.shift ?? 'Unspecified'} ·{' '}
                    {position.station && /^\d+$/.test(position.station)
                      ? `Station ${position.station}`
                      : (position.station ?? 'Location not specified')}
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {position.stableSlotKey}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-foreground">
                    {position.unit ?? 'Unspecified'}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {position.positionName ?? 'Unspecified'} ·{' '}
                      {position.applicableRank ?? 'No rank'}
                    </p>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-foreground">
                    {position.member === null ? (
                      position.occupancy === 'vacant' ? (
                        'Vacant'
                      ) : (
                        'Assigned member needs review'
                      )
                    ) : (
                      <Link
                        href={
                          `/admin/department?memberId=${position.member.id}&as_of=${roster.asOf}` as Route
                        }
                        className="font-medium text-info underline"
                      >
                        {`${position.member.firstName ?? ''} ${position.member.lastName ?? ''}`.trim() ||
                          'Member name unavailable'}
                      </Link>
                    )}{' '}
                    {position.member !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">{position.member.rank}</p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <span
                      className={
                        position.occupancy === 'occupied' ? 'text-success' : 'text-warning'
                      }
                    >
                      {position.occupancy}
                    </span>
                    {position.administrativeAssignment && (
                      <p className="mt-1 text-xs text-info">Administrative / non-biddable</p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-right">
                    {position.assignment !== null && (
                      <Link
                        href={
                          `/admin/department?memberId=${position.assignment.memberId}&as_of=${roster.asOf}` as Route
                        }
                        className="mr-3 text-sm font-medium text-info hover:text-info"
                      >
                        History
                      </Link>
                    )}
                    {position.occupancy === 'vacant' ? (
                      <Button
                        disabled={locked}
                        type="button"
                        onClick={() => retirePosition(position)}
                        className="text-sm font-medium text-destructive hover:text-destructive disabled:opacity-50"
                      >
                        Retire seat
                      </Button>
                    ) : (
                      <Link
                        href={
                          (position.assignment
                            ? `/admin/department?memberId=${position.assignment.memberId}&as_of=${roster.asOf}`
                            : `/admin/department?as_of=${roster.asOf}`) as Route
                        }
                        className="text-sm font-medium text-destructive hover:text-destructive"
                      >
                        Reassign
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <TaskPanel
        open={retirementOpen}
        onClose={() => {
          if (busy) return;
          setRetirementOpen(false);
          if (!uncertain) {
            setRetirement(null);
            setPreview(null);
            setRetirementError(null);
          }
        }}
        title="Retire staffing position"
        description="Review the dated dependencies before recording a position retirement."
      >
        {retirement && (
          <div className="space-y-4">
            <p className="font-semibold break-words">
              {retirement.position.positionName || retirement.position.stableSlotKey}
            </p>
            <p className="text-sm text-muted-foreground break-words">
              {retirement.position.stableSlotKey}
            </p>
            <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
              <Label className="grid gap-1 text-sm">
                Retirement date
                <Input
                  type="date"
                  required
                  value={retirement.effectiveOn}
                  onChange={(event) => {
                    setRetirement({ ...retirement, effectiveOn: event.target.value });
                    setPreview(null);
                    setRetirementError(null);
                  }}
                />
              </Label>
              <Label className="grid gap-1 text-sm sm:col-span-2">
                Retirement reason
                <Textarea
                  required
                  minLength={4}
                  value={retirement.reason}
                  onChange={(event) => {
                    setRetirement({ ...retirement, reason: event.target.value });
                    setPreview(null);
                    setRetirementError(null);
                  }}
                />
              </Label>
            </fieldset>
            {retirementError && (
              <p role="alert" className="rounded border border-warning/40 p-3 text-sm text-warning">
                {retirementError}
              </p>
            )}
            {currentPreview && (
              <section
                aria-label="Retirement impact"
                className="space-y-4 rounded border border-border p-3 text-sm"
              >
                <p>
                  Last active day: <strong>{currentPreview.lastActiveOn}</strong>. Historical
                  assignments and organization records will be retained.
                </p>
                {currentPreview.retirementBlocked || currentPreview.blockers.length > 0 ? (
                  <div role="alert" className="text-warning">
                    <p className="font-semibold">Resolve these dependencies before retirement:</p>
                    <ul className="mt-2 list-disc pl-5">
                      {currentPreview.blockers.map((blocker, index) => (
                        <li key={`${blocker.code}:${blocker.recordId}:${index}`}>
                          {blocker.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-success">
                    No blocking dependencies were found for this position on the selected date.
                  </p>
                )}
                <div>
                  <h3 className="font-semibold">Assignments and retained history</h3>
                  {currentPreview.assignments.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">No recorded assignments.</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {currentPreview.assignments.map((assignment) => (
                        <li key={assignment.id}>
                          <Link
                            className="font-medium text-info underline"
                            href={
                              `/admin/department?memberId=${assignment.memberId}&as_of=${roster.asOf}` as Route
                            }
                          >
                            {assignment.firstName} {assignment.lastName}
                          </Link>
                          <p>
                            {assignment.status} · {assignment.effectiveFrom} through{' '}
                            {assignment.effectiveTo ?? 'open-ended'}
                          </p>
                          <p className="text-muted-foreground">
                            {assignment.timing === 'future'
                              ? 'Starts after the retirement date'
                              : assignment.timing === 'covers_date'
                                ? 'Date range covers the retirement date'
                                : 'Ends before the retirement date'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="font-semibold">Recorded organization links</h3>
                  {currentPreview.organizationLinks.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">No recorded organization links.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {currentPreview.organizationLinks.map((link) => (
                        <li key={`${link.staffingPositionId}:${link.revision}`}>
                          {link.organizationUnitId === null
                            ? 'Association removed'
                            : (currentPreview.organizationVersions.find(
                                (unit) =>
                                  unit.id === link.organizationUnitId &&
                                  unit.effectiveOn <= link.effectiveOn &&
                                  (unit.nextEffectiveOn === null ||
                                    unit.nextEffectiveOn > link.effectiveOn),
                              )?.name ?? 'Organization name unavailable')}
                          <p className="text-muted-foreground">
                            Effective {link.effectiveOn}
                            {link.nextEffectiveOn
                              ? ` until ${link.nextEffectiveOn} (exclusive)`
                              : ' onward'}{' '}
                            · Source: {link.evidenceRef}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}
            <div className="flex flex-wrap gap-3">
              {!uncertain && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRetirementOpen(false);
                    setRetirement(null);
                    setPreview(null);
                    setRetirementError(null);
                  }}
                >
                  Cancel retirement draft
                </Button>
              )}
              <Button
                type="button"
                disabled={locked || retirement.reason.trim().length < 4 || !retirement.effectiveOn}
                onClick={() => void previewRetirement()}
              >
                Preview retirement
              </Button>
              <Button
                type="button"
                disabled={
                  busy ||
                  (!uncertain &&
                    (!currentPreview ||
                      currentPreview.retirementBlocked ||
                      currentPreview.blockers.length > 0))
                }
                onClick={() => void confirmRetirement()}
              >
                {uncertain
                  ? 'Retry same retirement request'
                  : busy
                    ? 'Working…'
                    : 'Confirm retirement'}
              </Button>
            </div>
          </div>
        )}
      </TaskPanel>
    </section>
  );
}
