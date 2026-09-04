'use client';

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

  async function command(payload: object, prefix: string) {
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    const response = await csrfFetch('/api/admin/personnel/changes', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `${prefix}-${crypto.randomUUID()}`,
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(errorText(body));
  }

  async function createPosition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const id = `admin-${crypto.randomUUID()}`;
      await command(
        {
          kind: 'POSITION_CREATE',
          effective_on: form.effective_on,
          reason: form.reason,
          staffing_position: {
            id,
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
        },
        'staffing-position-create',
      );
      setNotice(
        'Authorized staffing seat created. Reload this page to view its effective-dated projection.',
      );
      setForm((current) => ({ ...current, position_name: '', seat: '1', reason: '' }));
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
      await command(
        {
          kind: 'POSITION_RETIRE',
          effective_on: form.effective_on,
          reason,
          staffing_position_id: position.id,
        },
        'staffing-position-retire',
      );
      setNotice(
        'Position retired through the effective-dated lifecycle. Reload this page to view its historical projection.',
      );
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
          <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
            Authorized capacity
          </p>
          <h1 id="staffing-structure-heading" className="mt-1 font-heading text-3xl text-white">
            Staffing Structure
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Create effective-dated authorized seats, review capacity and occupancy, and retire
            vacant capacity without destroying historical assignments. A vacancy is never labelled a
            Bid opportunity.
          </p>
        </div>
        <Link
          href="/admin/personnel"
          className="inline-flex min-h-11 items-center rounded border border-red-600 bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-600"
        >
          Move or reassign a member
        </Link>
      </header>

      <form
        onSubmit={(event) => void createPosition(event)}
        className="grid gap-4 rounded-xl border border-slate-700 bg-slate-800/60 p-5 md:grid-cols-3"
      >
        <div className="md:col-span-3">
          <h2 className="font-heading text-xl text-white">Add authorized staffing seat</h2>
          <p className="mt-1 text-sm text-slate-400">
            The manager generates the canonical key from the reviewed operational fields; operators
            never enter an internal identifier.
          </p>
        </div>
        <label>
          <span className="text-sm text-slate-200">Shift</span>
          <select
            value={form.shift}
            onChange={(e) => update('shift', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          >
            <option value="A">A Shift</option>
            <option value="B">B Shift</option>
            <option value="C">C Shift</option>
            <option value="D">D / Days</option>
          </select>
        </label>
        <label>
          <span className="text-sm text-slate-200">Station</span>
          <input
            required
            value={form.station}
            onChange={(e) => update('station', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label>
          <span className="text-sm text-slate-200">Unit</span>
          <input
            required
            value={form.unit}
            onChange={(e) => update('unit', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label>
          <span className="text-sm text-slate-200">Division</span>
          <input
            value={form.division}
            onChange={(e) => update('division', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label>
          <span className="text-sm text-slate-200">Position</span>
          <input
            required
            value={form.position_name}
            onChange={(e) => update('position_name', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label>
          <span className="text-sm text-slate-200">Applicable rank</span>
          <select
            value={form.applicable_rank}
            onChange={(e) => update('applicable_rank', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          >
            {rankOptions.map((rank) => (
              <option key={rank}>{rank}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm text-slate-200">Seat number</span>
          <input
            required
            value={form.seat}
            onChange={(e) => update('seat', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label>
          <span className="text-sm text-slate-200">Effective date</span>
          <input
            required
            type="date"
            value={form.effective_on}
            onChange={(e) => update('effective_on', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label className="md:col-span-2">
          <span className="text-sm text-slate-200">Reason</span>
          <input
            required
            minLength={4}
            value={form.reason}
            onChange={(e) => update('reason', e.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <p className="rounded border border-sky-800 bg-sky-950/40 px-3 py-2 text-xs text-sky-100 md:col-span-3">
          Reviewable canonical key:{' '}
          <span className="font-mono">{canonicalKey || 'Complete the operational fields'}</span>
        </p>
        <button
          disabled={busy || canonicalKey.length === 0}
          type="submit"
          className="min-h-11 w-fit rounded bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Recording…' : 'Create authorized seat'}
        </button>
      </form>
      {error !== null && (
        <p
          role="alert"
          className="rounded border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <output className="block rounded border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </output>
      )}
      <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl text-white">Capacity and occupancy</h2>
            <p className="mt-1 text-sm text-slate-400">
              As of {roster.asOf}: {roster.summary.totalPositions} seats,{' '}
              {roster.summary.occupiedPositions} occupied, {roster.summary.vacantPositions} vacant.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <form action="/admin/staffing-structure" method="get" className="flex items-end gap-2">
              <label className="block">
                <span className="text-sm text-slate-200">Projection date</span>
                <input
                  type="date"
                  name="as_of"
                  defaultValue={roster.asOf}
                  className="mt-1 min-h-11 rounded border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
              <button
                type="submit"
                className="min-h-11 rounded border border-slate-600 px-3 text-sm text-slate-100 hover:bg-slate-700"
              >
                View projection
              </button>
            </form>
            <label className="block">
              <span className="text-sm text-slate-200">Search position</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mt-1 min-h-11 rounded border border-slate-600 bg-slate-950 px-3 text-white"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Shift / station</th>
                <th className="px-3 py-2">Unit / seat</th>
                <th className="px-3 py-2">Occupant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {visible.map((position) => (
                <tr key={position.id}>
                  <td className="px-3 py-3 text-slate-200">
                    {position.shift ?? 'Unspecified'} · Station {position.station ?? 'Unspecified'}
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {position.stableSlotKey}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-slate-100">
                    {position.unit ?? 'Unspecified'}
                    <p className="mt-1 text-xs text-slate-400">
                      {position.positionName ?? 'Unspecified'} ·{' '}
                      {position.applicableRank ?? 'No rank'}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-slate-200">
                    {position.member === null
                      ? 'Vacant'
                      : `${position.member.firstName ?? ''} ${position.member.lastName ?? ''}`}{' '}
                    {position.member !== null && (
                      <p className="mt-1 text-xs text-slate-400">{position.member.rank}</p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={
                        position.occupancy === 'occupied' ? 'text-emerald-300' : 'text-amber-200'
                      }
                    >
                      {position.occupancy}
                    </span>
                    {position.administrativeAssignment && (
                      <p className="mt-1 text-xs text-sky-200">Administrative / non-biddable</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {position.assignment !== null && (
                      <Link
                        href={`/admin/personnel?memberId=${position.assignment.memberId}&assignmentId=${position.assignment.id}`}
                        className="mr-3 text-sm font-medium text-sky-300 hover:text-sky-100"
                      >
                        History
                      </Link>
                    )}
                    {position.occupancy === 'vacant' ? (
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() => void retirePosition(position)}
                        className="text-sm font-medium text-red-300 hover:text-red-100 disabled:opacity-50"
                      >
                        Retire seat
                      </button>
                    ) : (
                      <Link
                        href="/admin/personnel"
                        className="text-sm font-medium text-red-300 hover:text-red-100"
                      >
                        Reassign
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
