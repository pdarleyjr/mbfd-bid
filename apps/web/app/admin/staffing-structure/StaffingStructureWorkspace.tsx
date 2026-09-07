'use client';
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
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';
import { useRetainedMutation } from '@/lib/use-retained-mutation';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type {
  CurrentRosterPosition,
  CurrentRosterResponse,
} from '../current-rosters/CurrentRostersWorkspace';

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

export function StaffingStructureWorkspace({ roster }: { roster: CurrentRosterResponse }) {
  const refreshProjections = usePersonnelProjectionRefresh();
  const mutation = useRetainedMutation<Record<string, unknown>>('staffing-position');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    division: '',
    shift: 'A',
    station: '',
    unit: '',
    position_name: '',
    applicable_rank: 'FF',
    seat: '1',
    effective_on: roster.asOf,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  async function command(request: ReturnType<typeof mutation.prepare>) {
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    const response = await csrfFetch('/api/admin/personnel/changes', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.key,
      },
      body: JSON.stringify(request.payload),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(errorText(body));
    mutation.accepted(request.key);
  }

  async function createPosition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await command(
        mutation.prepare(JSON.stringify({ operation: 'create', form }), () => ({
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
        })),
      );
      setNotice('Authorized staffing seat created. Effective-dated projections are refreshing.');
      setForm((current) => ({ ...current, position_name: '', seat: '1', reason: '' }));
      await refreshProjections();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The staffing seat was not created.');
    } finally {
      setBusy(false);
    }
  }

  async function retirePosition(position: CurrentRosterPosition) {
    const reason = window.prompt(
      `Reason to retire ${position.stableSlotKey} effective ${form.effective_on}:`,
    );
    if (reason === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        kind: 'POSITION_RETIRE',
        effective_on: form.effective_on,
        reason,
        staffing_position_id: position.id,
      };
      await command(mutation.prepare(JSON.stringify(payload), () => payload));
      setNotice(
        'Position retired through the effective-dated lifecycle. Updated projections are refreshing.',
      );
      await refreshProjections();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The position was not retired.');
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
          <h1
            id="staffing-structure-heading"
            className="mt-1 font-heading text-3xl text-foreground"
          >
            Staffing Structure
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-foreground">
            Create effective-dated authorized seats, review capacity and occupancy, and retire
            vacant capacity without destroying historical assignments. A vacancy is never labelled a
            Bid opportunity.
          </p>
        </div>
        <Link
          href="/admin/personnel"
          className="inline-flex min-h-11 items-center rounded border border-destructive/40 bg-destructive px-4 text-sm font-semibold text-primary-foreground hover:bg-destructive"
        >
          Move or reassign a member
        </Link>
      </header>

      <form
        onSubmit={(event) => void createPosition(event)}
        className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-3"
      >
        <div className="md:col-span-3">
          <h2 className="font-heading text-xl text-foreground">Add authorized staffing seat</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The manager generates the canonical key from the reviewed operational fields; operators
            never enter an internal identifier.
          </p>
        </div>
        <Label>
          <span className="text-sm text-foreground">Shift</span>
          <NativeSelect
            value={form.shift}
            onChange={(e) => update('shift', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          >
            <option value="A">A Shift</option>
            <option value="B">B Shift</option>
            <option value="C">C Shift</option>
            <option value="D">D / Days</option>
          </NativeSelect>
        </Label>
        <Label>
          <span className="text-sm text-foreground">Station</span>
          <Input
            required
            value={form.station}
            onChange={(e) => update('station', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label>
          <span className="text-sm text-foreground">Unit</span>
          <Input
            required
            value={form.unit}
            onChange={(e) => update('unit', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label>
          <span className="text-sm text-foreground">Division</span>
          <Input
            value={form.division}
            onChange={(e) => update('division', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label>
          <span className="text-sm text-foreground">Position</span>
          <Input
            required
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
        <Button
          disabled={busy || canonicalKey.length === 0}
          type="submit"
          className="min-h-11 w-fit rounded bg-destructive px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Recording…' : 'Create authorized seat'}
        </Button>
      </form>
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
            <form action="/admin/staffing-structure" method="get" className="flex items-end gap-2">
              <Label className="block">
                <span className="text-sm text-foreground">Projection date</span>
                <Input
                  type="date"
                  name="as_of"
                  defaultValue={roster.asOf}
                  className="mt-1 min-h-11 rounded border border-border bg-card px-3 text-foreground"
                />
              </Label>
              <Button
                type="submit"
                className="min-h-11 rounded border border-border px-3 text-sm text-foreground hover:bg-muted"
              >
                View projection
              </Button>
            </form>
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
        <div className="mt-4 overflow-x-auto">
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
                    {position.shift ?? 'Unspecified'} · Station {position.station ?? 'Unspecified'}
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
                    {position.member === null
                      ? 'Vacant'
                      : `${position.member.firstName ?? ''} ${position.member.lastName ?? ''}`}{' '}
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
                        href={`/admin/personnel?memberId=${position.assignment.memberId}&assignmentId=${position.assignment.id}`}
                        className="mr-3 text-sm font-medium text-info hover:text-info"
                      >
                        History
                      </Link>
                    )}
                    {position.occupancy === 'vacant' ? (
                      <Button
                        disabled={busy}
                        type="button"
                        onClick={() => void retirePosition(position)}
                        className="text-sm font-medium text-destructive hover:text-destructive disabled:opacity-50"
                      >
                        Retire seat
                      </Button>
                    ) : (
                      <Link
                        href="/admin/personnel"
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
    </section>
  );
}
