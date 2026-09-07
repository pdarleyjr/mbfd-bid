'use client';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { OrganizationSeatLinks } from './OrganizationSeatLinks';

type Unit = {
  id: string;
  kind: 'STATION' | 'GROUP' | 'APPARATUS';
  name: string;
  parentId: string | null;
  effectiveOn: string;
  status: 'active' | 'retired';
  revision: number;
  latestRevision: number;
};
const blank = {
  kind: 'STATION' as Unit['kind'],
  display_name: '',
  parent_id: '',
  effective_on: '',
  status: 'active' as Unit['status'],
  evidence_ref: '',
  reason: '',
};
const inputClass =
  'mt-1 min-h-11 w-full min-w-0 rounded border border-slate-600 bg-slate-950 px-3 text-white';

export function OrganizationWorkspace() {
  const client = useQueryClient();
  const [asOf, setAsOf] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, unknown>[] | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const baseline = editing
    ? {
        ...blank,
        kind: editing.kind,
        display_name: editing.name,
        parent_id: editing.parentId ?? '',
        effective_on: editing.effectiveOn,
        status: editing.status,
      }
    : blank;
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useUnsavedChanges(dirty, 'organization edits');
  const catalog = useQuery({
    queryKey: ['admin', 'organization', asOf],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const res = await fetch(`/api/admin/organization${asOf ? `?as_of=${asOf}` : ''}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Organization catalog unavailable');
      return (await res.json()) as { asOf: string; units: Unit[] };
    },
  });
  const units = catalog.data?.units ?? [];
  const dependencies = useQuery({
    queryKey: ['admin', 'organization', 'dependencies', editing?.id, form.effective_on],
    enabled: !!editing && !!form.effective_on,
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/organization/${editing?.id}/dependencies?as_of=${form.effective_on}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Dependencies unavailable');
      return (await res.json()) as {
        retirementBlocked: boolean;
        children: { id: string; name: string }[];
        seats: { id: string; stableSlotKey: string }[];
      };
    },
  });
  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const reset = () => {
    setEditing(null);
    setForm(blank);
    setHistory(null);
    pending.current = null;
  };
  const begin = (unit: Unit) => {
    setEditing(unit);
    setForm({
      ...blank,
      kind: unit.kind,
      display_name: unit.name,
      parent_id: unit.parentId ?? '',
      effective_on: unit.effectiveOn,
      status: unit.status,
    });
    setError(null);
    setNotice(null);
    setHistory(null);
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { kind, ...fields } = form;
    const body = {
      ...fields,
      parent_id: form.parent_id || null,
      expected_revision: editing?.revision ?? 0,
      ...(!editing ? { kind } : {}),
    };
    const fingerprint = JSON.stringify({ id: editing?.id, body });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await createCsrfAwareFetch(fetch, () => window.location.origin)(
        `/api/admin/organization${editing ? `/${editing.id}` : ''}`,
        {
          method: editing ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
          body: JSON.stringify(body),
        },
      );
      const saved = (await response.json()) as { error?: string; unit?: Unit };
      if (!response.ok || !saved.unit)
        throw new Error(
          (saved.error ?? 'Organization change was not accepted').replaceAll('_', ' '),
        );
      setNotice('Organization revision saved with its effective date and audit receipt.');
      setAsOf(form.effective_on);
      reset();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'organization'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
        invalidateWorkingBidBoards(client),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Organization service unavailable. Your edits remain here.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function readHistory(id: string) {
    try {
      const res = await fetch(`/api/admin/organization/${id}/history`, { credentials: 'include' });
      if (!res.ok) throw new Error('History unavailable');
      const body = (await res.json()) as { history: Record<string, unknown>[] };
      setHistory(body.history);
    } catch {
      setError('Organization history could not be loaded.');
    }
  }
  return (
    <section className="mx-auto max-w-6xl space-y-6 text-slate-100">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
          Year-round staffing structure
        </p>
        <h1 className="mt-1 font-heading text-3xl">Organization</h1>
        <p className="mt-2 max-w-3xl text-slate-300">
          Maintain stations, organizational groups, and apparatus independently of their authorized
          seats. Dated changes preserve each identity and its history.
        </p>
        <Link
          href="/admin/staffing-structure"
          className="mt-3 inline-flex min-h-11 items-center text-red-300 underline"
        >
          Manage authorized seats
        </Link>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          View organization as of
          <input
            type="date"
            value={asOf || catalog.data?.asOf || ''}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          Search organization
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {catalog.isError && (
        <p role="alert" className="text-amber-200">
          {catalog.error.message}.{catalog.data ? ' Showing the last successful view.' : ''}
        </p>
      )}
      <form
        onSubmit={save}
        className="grid gap-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:grid-cols-2"
      >
        <h2 className="font-heading text-xl md:col-span-2">
          {editing ? `Edit ${editing.name}` : 'Add organization'}
        </h2>
        <label className="text-sm">
          Type
          <select
            value={form.kind}
            disabled={!!editing}
            onChange={(e) => update('kind', e.target.value)}
            className={inputClass}
          >
            <option value="STATION">Station</option>
            <option value="GROUP">Organizational group</option>
            <option value="APPARATUS">Apparatus</option>
          </select>
        </label>
        <label className="text-sm">
          Display name
          <input
            required
            maxLength={160}
            value={form.display_name}
            onChange={(e) => update('display_name', e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          Parent
          <select
            value={form.parent_id}
            onChange={(e) => update('parent_id', e.target.value)}
            className={inputClass}
          >
            <option value="">No parent</option>
            {units
              .filter(
                (u) =>
                  u.id !== editing?.id &&
                  u.status === 'active' &&
                  (form.kind === 'STATION'
                    ? u.kind === 'GROUP'
                    : form.kind === 'APPARATUS'
                      ? u.kind !== 'APPARATUS'
                      : false),
              )
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-xs text-slate-400">
            Set the viewing date to review parents available on the effective date.
          </span>
        </label>
        <label className="text-sm">
          Effective on
          <input
            required
            type="date"
            min={editing?.effectiveOn}
            value={form.effective_on}
            onChange={(e) => update('effective_on', e.target.value)}
            className={inputClass}
          />
        </label>
        {editing && (
          <label className="text-sm">
            Lifecycle
            <select
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
              className={inputClass}
            >
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
          </label>
        )}
        <label className="text-sm">
          Authoritative source reference
          <input
            required
            minLength={4}
            maxLength={500}
            value={form.evidence_ref}
            onChange={(e) => update('evidence_ref', e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Reason
          <textarea
            required
            minLength={4}
            maxLength={500}
            value={form.reason}
            onChange={(e) => update('reason', e.target.value)}
            className={`${inputClass} min-h-20 py-2`}
          />
        </label>
        {dependencies.data && (
          <div className="text-sm text-slate-300 md:col-span-2">
            <p>
              {dependencies.data.retirementBlocked
                ? 'Retirement requires review of the linked children or seats.'
                : 'No active or future dependency blocks retirement.'}
            </p>
            <ul>
              {dependencies.data.children.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
              {dependencies.data.seats.map((s) => (
                <li key={s.id}>{s.stableSlotKey}</li>
              ))}
            </ul>
          </div>
        )}
        {dependencies.isError && (
          <p role="alert" className="text-amber-200">
            Dependencies could not be loaded.
          </p>
        )}
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <button
            disabled={busy}
            type="submit"
            className="min-h-11 rounded bg-red-700 px-4 font-semibold disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save organization'}
          </button>
          {(editing || dirty) && (
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="min-h-11 rounded border border-slate-600 px-4"
            >
              Cancel local edit
            </button>
          )}
        </div>
      </form>
      {error && (
        <p role="alert" className="rounded border border-amber-600 p-3 text-amber-100">
          {error}
        </p>
      )}
      {notice && (
        <output className="block rounded border border-emerald-700 p-3 text-emerald-100">
          {notice}
        </output>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {units
          .filter((u) => `${u.name} ${u.kind}`.toLowerCase().includes(search.toLowerCase()))
          .map((unit) => (
            <li key={unit.id} className="min-w-0 rounded-lg border border-slate-700 p-4">
              <h2 className="break-words font-semibold">{unit.name}</h2>
              <p className="mt-1 text-sm text-slate-300">
                {unit.kind.toLowerCase()} · {unit.status} · Effective {unit.effectiveOn}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {unit.parentId
                  ? `Parent: ${units.find((u) => u.id === unit.parentId)?.name ?? 'Unavailable at viewing date'}`
                  : 'No parent'}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  disabled={busy || dirty || unit.revision !== unit.latestRevision}
                  type="button"
                  onClick={() => begin(unit)}
                  className="min-h-11 rounded border border-slate-600 px-3 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void readHistory(unit.id)}
                  className="min-h-11 rounded border border-slate-600 px-3"
                >
                  History
                </button>
              </div>
              {unit.revision !== unit.latestRevision && (
                <p className="mt-2 text-sm text-amber-200">
                  A later version exists. View its effective date before editing.
                </p>
              )}
            </li>
          ))}
      </ul>
      {catalog.isSuccess && units.length === 0 && (
        <p className="text-slate-300">
          No organization entries exist for this date. A reviewed station may be created before it
          has seats.
        </p>
      )}
      {catalog.data && <OrganizationSeatLinks asOf={catalog.data.asOf} units={units} />}
      {history && (
        <section className="rounded border border-slate-700 p-4">
          <h2 className="font-heading text-xl">Recorded history</h2>
          <ol className="mt-3 space-y-3">
            {history.map((row) => (
              <li key={String(row.revision)} className="break-words text-sm">
                <strong>{String(row.display_name)}</strong> · {String(row.status)} from{' '}
                {String(row.effective_on)}
                <p>
                  {String(row.reason)} · Source: {String(row.evidence_ref)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
