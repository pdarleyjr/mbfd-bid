'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type { DepartmentRetirementImpact } from '@mbfd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
  'mt-1 min-h-11 w-full min-w-0 rounded border border-border bg-card px-3 text-foreground';

export function OrganizationWorkspace({
  initialDate = '',
  onMutationLocked,
}: { initialDate?: string; onMutationLocked?: (locked: boolean) => void }) {
  const client = useQueryClient();
  const Heading = initialDate ? 'h2' : 'h1';
  const [asOf, setAsOf] = useState(initialDate);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [linkDirty, setLinkDirty] = useState(false);
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
  useEffect(() => {
    onMutationLocked?.(dirty || busy || uncertain || linkDirty);
  }, [dirty, busy, uncertain, linkDirty, onMutationLocked]);
  useUnsavedChanges(dirty || busy || uncertain, 'organization edits');
  const catalog = useQuery({
    queryKey: ['admin', 'organization', asOf],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/admin/organization${asOf ? `?as_of=${asOf}` : ''}`, {
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (!res.ok) throw new Error('Organization catalog unavailable');
      return (await res.json()) as { asOf: string; units: Unit[] };
    },
  });
  const units = catalog.data?.units ?? [];
  const dependencies = useQuery({
    queryKey: ['admin', 'organization', 'dependencies', editing?.id, form.effective_on],
    enabled: !!editing && !!form.effective_on,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/admin/organization/${editing?.id}/dependencies?as_of=${form.effective_on}`,
        { credentials: 'include', cache: 'no-store', signal },
      );
      if (!res.ok) throw new Error('Dependencies unavailable');
      return (await res.json()) as {
        retirementBlocked: boolean;
        children: { id: string; name: string }[];
        seats: { id: string; stableSlotKey: string }[];
        impact: DepartmentRetirementImpact;
      };
    },
  });
  const retiring = !!editing && form.status === 'retired';
  const retirementReady =
    !retiring ||
    (dependencies.isSuccess &&
      !dependencies.isFetching &&
      !dependencies.data.retirementBlocked &&
      dependencies.data.impact?.target.id === editing.id &&
      dependencies.data.impact.effectiveOn === form.effective_on &&
      dependencies.data.impact.target.kind !== 'POSITION' &&
      dependencies.data.impact.target.authorization.revision === editing.revision);
  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const reset = () => {
    if (uncertain) return;
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
    if (busy || (!uncertain && !retirementReady)) return;
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
    let unconfirmed = true;
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
      if (!response.ok) {
        if (!uncertain && response.status >= 400 && response.status < 500) unconfirmed = false;
        throw new Error(
          (saved.error ?? 'Organization change was not accepted').replaceAll('_', ' '),
        );
      }
      if (
        !saved.unit ||
        (editing && saved.unit.id !== editing.id) ||
        saved.unit.name !== body.display_name ||
        saved.unit.effectiveOn !== body.effective_on ||
        saved.unit.parentId !== body.parent_id ||
        saved.unit.status !== body.status ||
        saved.unit.revision !== body.expected_revision + 1
      ) {
        throw new Error(
          'The response did not confirm this organization change. Retry the retained request.',
        );
      }
      unconfirmed = false;
      setUncertain(false);
      setNotice('Organization revision saved with its effective date and audit receipt.');
      setAsOf(form.effective_on);
      setEditing(null);
      setForm(blank);
      setHistory(null);
      pending.current = null;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'organization'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
        client.invalidateQueries({ queryKey: ['admin', 'department'] }),
        client.invalidateQueries({ queryKey: ['admin', 'current-roster'] }),
        invalidateWorkingBidBoards(client),
      ]);
    } catch (caught) {
      setUncertain(unconfirmed);
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
    <section className="mx-auto max-w-6xl space-y-6 text-foreground">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Year-round staffing structure
        </p>
        <Heading className="mt-1 font-heading text-3xl">Organization</Heading>
        <p className="mt-2 max-w-3xl text-foreground">
          Maintain stations, organizational groups, and apparatus independently of their authorized
          seats. Dated changes preserve each identity and its history.
        </p>
        <Link
          href={'/admin/department/roster' as Route}
          className="mt-3 inline-flex min-h-11 items-center text-destructive underline"
        >
          Manage authorized seats
        </Link>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Label className="text-sm">
          View organization as of
          <Input
            type="date"
            disabled={dirty || busy || uncertain || linkDirty}
            value={asOf || catalog.data?.asOf || ''}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputClass}
          />
        </Label>
        <Label className="text-sm">
          Search organization
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
        </Label>
      </div>
      {catalog.isError && (
        <p role="alert" className="text-warning">
          {catalog.error.message}.{catalog.data ? ' Showing the last successful view.' : ''}
        </p>
      )}
      <form
        onSubmit={save}
        className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2"
      >
        <fieldset disabled={busy || uncertain} className="contents">
          <h2 className="font-heading text-xl md:col-span-2">
            {editing ? `Edit ${editing.name}` : 'Add organization'}
          </h2>
          <Label className="text-sm">
            Type
            <NativeSelect
              value={form.kind}
              disabled={!!editing}
              onChange={(e) => update('kind', e.target.value)}
              className={inputClass}
            >
              <option value="STATION">Station</option>
              <option value="GROUP">Organizational group</option>
              <option value="APPARATUS">Apparatus</option>
            </NativeSelect>
          </Label>
          <Label className="text-sm">
            Display name
            <Input
              required
              maxLength={160}
              value={form.display_name}
              onChange={(e) => update('display_name', e.target.value)}
              className={inputClass}
            />
          </Label>
          <Label className="text-sm">
            Parent
            <NativeSelect
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
            </NativeSelect>
            <span className="mt-1 block text-xs text-muted-foreground">
              Set the viewing date to review parents available on the effective date.
            </span>
          </Label>
          <Label className="text-sm">
            Effective on
            <Input
              required
              type="date"
              min={editing?.effectiveOn}
              value={form.effective_on}
              onChange={(e) => update('effective_on', e.target.value)}
              className={inputClass}
            />
          </Label>
          {editing && (
            <Label className="text-sm">
              Lifecycle
              <NativeSelect
                value={form.status}
                onChange={(e) => update('status', e.target.value)}
                className={inputClass}
              >
                <option value="active">Active</option>
                <option value="retired">Retired</option>
              </NativeSelect>
            </Label>
          )}
          <Label className="text-sm">
            Authoritative source reference
            <Input
              required
              minLength={4}
              maxLength={500}
              value={form.evidence_ref}
              onChange={(e) => update('evidence_ref', e.target.value)}
              className={inputClass}
            />
          </Label>
          <Label className="text-sm md:col-span-2">
            Reason
            <Textarea
              required
              minLength={4}
              maxLength={500}
              value={form.reason}
              onChange={(e) => update('reason', e.target.value)}
              className={`${inputClass} min-h-20 py-2`}
            />
          </Label>
          {dependencies.data && (
            <div className="text-sm text-foreground md:col-span-2">
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
            <p role="alert" className="text-warning">
              Dependencies could not be loaded.
            </p>
          )}
          {retiring && dependencies.isFetching && (
            <output className="text-sm md:col-span-2">Loading retirement impact…</output>
          )}
          {retiring && dependencies.data?.impact && (
            <section
              aria-label="Organization retirement impact"
              className="space-y-3 rounded-lg border border-border p-4 text-sm md:col-span-2"
            >
              <p className="font-semibold">
                Retire {dependencies.data.impact.target.name} from{' '}
                {dependencies.data.impact.effectiveOn}
              </p>
              <p>
                Existing organization, assignment and link history is retained. Future dated
                dependencies must be resolved before retirement.
              </p>
              {dependencies.data.impact.blockers.length > 0 && (
                <ul className="list-disc pl-5">
                  {dependencies.data.impact.blockers.map((blocker) => (
                    <li key={`${blocker.code}:${blocker.recordId}`}>{blocker.detail}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="min-h-8 cursor-pointer">
                  Related assignment records ({dependencies.data.impact.assignments.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {dependencies.data.impact.assignments.map((assignment) => (
                    <li key={assignment.id}>
                      {assignment.firstName} {assignment.lastName} · {assignment.status} ·{' '}
                      {assignment.effectiveFrom} through {assignment.effectiveTo ?? 'an open end'}
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary className="min-h-8 cursor-pointer">
                  Dated organization and link history (
                  {dependencies.data.impact.organizationVersions.length +
                    dependencies.data.impact.organizationLinks.length}
                  )
                </summary>
                <ul className="mt-2 space-y-2">
                  {dependencies.data.impact.organizationVersions.map((version) => (
                    <li key={`${version.id}:${version.revision}`}>
                      {version.name} · {version.status} from {version.effectiveOn}
                      {version.nextEffectiveOn
                        ? ` until ${version.nextEffectiveOn} (exclusive)`
                        : ''}{' '}
                      · Source: {version.evidenceRef}
                    </li>
                  ))}
                  {dependencies.data.impact.organizationLinks.map((link) => (
                    <li key={`${link.staffingPositionId}:${link.revision}`}>
                      {link.stableSlotKey} · Linked from {link.effectiveOn}
                      {link.nextEffectiveOn ? ` until ${link.nextEffectiveOn} (exclusive)` : ''} ·
                      Source: {link.evidenceRef}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
        </fieldset>
        {uncertain && (
          <p role="alert" className="text-sm text-warning md:col-span-2">
            The result is not confirmed. Edits are locked so you can retry the same request and
            recover its receipt.
          </p>
        )}
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button
            disabled={busy || (!uncertain && !retirementReady)}
            type="submit"
            className="min-h-11 rounded bg-destructive px-4 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy
              ? 'Saving…'
              : uncertain
                ? 'Retry saved request'
                : retiring
                  ? 'Confirm retirement'
                  : 'Save organization'}
          </Button>
          {(editing || dirty) && (
            <Button
              type="button"
              disabled={busy || uncertain}
              onClick={reset}
              className="min-h-11 rounded border border-border px-4"
            >
              Cancel local edit
            </Button>
          )}
        </div>
      </form>
      {error && (
        <p role="alert" className="rounded border border-warning/40 p-3 text-warning">
          {error}
        </p>
      )}
      {notice && (
        <output className="block rounded border border-success/40 p-3 text-success">
          {notice}
        </output>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {units
          .filter((u) => `${u.name} ${u.kind}`.toLowerCase().includes(search.toLowerCase()))
          .map((unit) => (
            <li key={unit.id} className="min-w-0 rounded-lg border border-border p-4">
              <h2 className="break-words font-semibold">{unit.name}</h2>
              <p className="mt-1 text-sm text-foreground">
                {unit.kind.toLowerCase()} · {unit.status} · Effective {unit.effectiveOn}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {unit.parentId
                  ? `Parent: ${units.find((u) => u.id === unit.parentId)?.name ?? 'Unavailable at viewing date'}`
                  : 'No parent'}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={busy || uncertain || dirty || unit.revision !== unit.latestRevision}
                  type="button"
                  onClick={() => begin(unit)}
                  className="min-h-11 rounded border border-border px-3 disabled:opacity-50"
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  onClick={() => void readHistory(unit.id)}
                  className="min-h-11 rounded border border-border px-3"
                >
                  History
                </Button>
              </div>
              {unit.revision !== unit.latestRevision && (
                <p className="mt-2 text-sm text-warning">
                  A later version exists. View its effective date before editing.
                </p>
              )}
            </li>
          ))}
      </ul>
      {catalog.isSuccess && units.length === 0 && (
        <p className="text-foreground">
          No organization entries exist for this date. A reviewed station may be created before it
          has seats.
        </p>
      )}
      {catalog.data && (
        <OrganizationSeatLinks
          key={catalog.data.asOf}
          asOf={catalog.data.asOf}
          units={units}
          onDirtyChange={setLinkDirty}
        />
      )}
      {history && (
        <section className="rounded border border-border p-4">
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
