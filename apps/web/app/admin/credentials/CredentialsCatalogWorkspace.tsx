'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export type CatalogCredential = {
  id: number;
  name: string;
  fyPointsDefault: number;
  holderCount: number;
  revision?: number;
  policyName?: string;
  retiredOn?: string | null;
};

type Holder = {
  memberId: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  historyHref: string;
  legacyReference: boolean;
};

function nextKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function readError(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    return String((payload as { error: unknown }).error).replaceAll('_', ' ');
  }
  return 'The catalog change was not accepted.';
}

export function CredentialsCatalogWorkspace({
  initialCredentials,
}: {
  initialCredentials: CatalogCredential[];
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ['admin', 'credentials'],
    initialData: initialCredentials,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const rows: CatalogCredential[] = [];
      let total = 1;
      while (rows.length < total) {
        const response = await fetch(`/api/admin/credentials?limit=500&offset=${rows.length}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Catalog refresh failed');
        const body = (await response.json()) as { credentials: CatalogCredential[]; total: number };
        total = body.total;
        if (body.credentials.length === 0 && rows.length < total)
          throw new Error('Incomplete catalog response');
        rows.push(...body.credentials);
      }
      return rows;
    },
  });
  const credentials = catalog.data;
  const [name, setName] = useState('');
  const [points, setPoints] = useState('0');
  const [reason, setReason] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<CatalogCredential | null>(null);
  const [retiredOn, setRetiredOn] = useState('');
  const [search, setSearch] = useState('');
  const [dependencies, setDependencies] = useState<{
    retirementBlocked: boolean;
    policyReferences: { version: string; status: string }[];
    memberReferences?: number;
    qualificationEventReferences?: number;
    frozenSessionReferences?: { sessionId: string; year: number; isMock: number }[];
  } | null>(null);
  const pendingRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [holderCredentialId, setHolderCredentialId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== (editing?.name ?? '') ||
    points !== String(editing?.fyPointsDefault ?? 0) ||
    retiredOn !== (editing?.retiredOn ?? '') ||
    reason !== '';
  useUnsavedChanges(dirty, 'credential edits');

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    void fetch(`/api/admin/credentials/${editing.id}/dependencies`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Dependency preview could not be loaded.');
        const result = (await res.json()) as NonNullable<typeof dependencies>;
        if (!controller.signal.aborted) setDependencies(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Dependency preview could not be loaded.');
      });
    return () => controller.abort();
  }, [editing]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const payload = {
      name,
      fy_points_default: Number(points),
      reason,
      ...(editing === null
        ? {}
        : { expected_revision: editing.revision ?? 0, retired_on: retiredOn || null }),
    };
    const fingerprint = JSON.stringify({ id: editingId, payload });
    if (pendingRequest.current?.fingerprint !== fingerprint)
      pendingRequest.current = { fingerprint, key: nextKey('credential') };
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    try {
      const response = await csrfFetch(
        editing === null ? '/api/admin/credentials' : `/api/admin/credentials/${editing.id}`,
        {
          method: editing === null ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': pendingRequest.current.key,
          },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as { credential?: CatalogCredential; error?: string };
      if (!response.ok || body.credential === undefined) {
        setError(readError(body));
        return;
      }
      queryClient.setQueryData<CatalogCredential[]>(['admin', 'credentials'], (current = []) => {
        const withoutChanged = current.filter(
          (credential) => credential.id !== body.credential?.id,
        );
        return [...withoutChanged, body.credential as CatalogCredential].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'credentials'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'annual-plan'] });
      setNotice(
        editing === null
          ? 'Credential created with an audit receipt.'
          : 'Credential updated with an audit receipt.',
      );
      setEditingId(null);
      setEditing(null);
      setRetiredOn('');
      setDependencies(null);
      pendingRequest.current = null;
      setName('');
      setPoints('0');
      setReason('');
    } catch {
      setError(
        'The credentials catalog service could not be reached. No local change was assumed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function openHolders(credential: CatalogCredential) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/credentials/${credential.id}/holders`, {
        credentials: 'include',
      });
      const body = (await response.json()) as { holders?: Holder[]; error?: string };
      if (!response.ok || body.holders === undefined) {
        setError(readError(body));
        return;
      }
      setHolderCredentialId(credential.id);
      setHolders(body.holders);
    } catch {
      setError('Credential holders could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(credential: CatalogCredential) {
    setEditingId(credential.id);
    setEditing(credential);
    setRetiredOn(credential.retiredOn ?? '');
    setDependencies(null);
    setName(credential.name);
    setPoints(String(credential.fyPointsDefault));
    setReason('');
    setNotice(null);
    setError(null);
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="credentials-catalog-heading">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
            Year-round personnel reference data
          </p>
          <h1
            id="credentials-catalog-heading"
            className="mt-1 font-heading text-3xl text-foreground"
          >
            Credentials &amp; Specialty Points
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-foreground">
            Manage the credential catalog and its default informational points. Current
            qualifications remain effective-dated evidence on each member; these defaults do not
            rewrite any frozen annual Bid score.
          </p>
        </div>
        <Link
          href="/admin/personnel/qualifications"
          className="inline-flex min-h-11 items-center rounded border border-destructive/40 bg-destructive px-4 text-sm font-semibold text-primary-foreground hover:bg-destructive"
        >
          Record qualification evidence
        </Link>
      </header>

      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <h2 className="font-heading text-xl text-foreground">
            {editing === null ? 'Add credential' : `Edit ${editing.name}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalog changes require a current step-up session and create an audit receipt.
          </p>
        </div>
        <Label>
          <span className="text-sm font-medium text-foreground">Credential name</span>
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        {editing !== null && (
          <Label>
            <span className="text-sm font-medium text-foreground">
              Retire from new annual preparation on
            </span>
            <Input
              type="date"
              value={retiredOn}
              onChange={(event) => setRetiredOn(event.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
            <span className="mt-1 block text-xs text-foreground">
              Leave blank to keep active. Retirement preserves qualification history and frozen
              bids.
            </span>
          </Label>
        )}
        {dependencies !== null && editing !== null && (
          <div className="rounded border border-border p-3 text-sm text-foreground md:col-span-2">
            <p>
              {dependencies.retirementBlocked
                ? 'An active policy references this credential. Retirement is blocked until a reviewed successor removes that dependency.'
                : 'No active policy blocks retirement. Review draft dependencies before changing availability.'}
            </p>
            <p className="mt-2">
              Referenced members: {dependencies.memberReferences ?? 'Unavailable'} · Qualification
              history events: {dependencies.qualificationEventReferences ?? 'Unavailable'}.
              Retirement preserves this evidence.
            </p>
            {dependencies.frozenSessionReferences && (
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer">
                  Frozen snapshots containing this credential (
                  {dependencies.frozenSessionReferences.length})
                </summary>
                <ul>
                  {dependencies.frozenSessionReferences.map((source) => (
                    <li key={source.sessionId} className="break-all">
                      {source.year} · {source.isMock ? 'Mock' : 'Official session'} ·{' '}
                      {source.sessionId}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {dependencies.policyReferences.length > 0 && (
              <ul className="mt-2">
                {dependencies.policyReferences.map((ref) => (
                  <li key={`${ref.version}-${ref.status}`}>
                    Policy {ref.version}: {ref.status}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Label>
          <span className="text-sm font-medium text-foreground">Default points</span>
          <Input
            required
            min="0"
            step="1"
            type="number"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label className="md:col-span-2">
          <span className="text-sm font-medium text-foreground">Reason</span>
          <Textarea
            required
            minLength={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 min-h-24 w-full rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded bg-destructive px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Saving…' : editing === null ? 'Create credential' : 'Save catalog change'}
          </Button>
          {editing !== null && (
            <Button
              type="button"
              onClick={() => {
                setEditingId(null);
                setEditing(null);
                setDependencies(null);
                setRetiredOn('');
                setName('');
                setPoints('0');
                setReason('');
              }}
              className="min-h-11 rounded border border-border px-4 text-sm font-semibold text-foreground"
            >
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive-surface px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {catalog.isError && (
        <output className="text-sm text-warning">
          Refresh failed. Showing the last successful catalog; saved changes still require server
          validation.
        </output>
      )}
      {editing !== null &&
        (credentials.find((row) => row.id === editing.id)?.revision ?? 0) !==
          (editing.revision ?? 0) && (
          <p role="alert" className="text-sm text-warning">
            This credential changed since you opened it. Your unsaved values remain here. Cancel
            this edit and reopen the current record before saving.
          </p>
        )}
      <Label className="block text-sm text-foreground">
        Search credentials
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3"
        />
      </Label>
      {notice !== null && (
        <output className="block rounded border border-success/40 bg-success-surface px-4 py-3 text-sm text-success">
          {notice}
        </output>
      )}

      <section
        className="overflow-hidden rounded-xl border border-border"
        aria-label="Credential catalog"
      >
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[48rem] text-left text-sm">
            <TableHeader className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
              <TableRow>
                <TableHead className="px-4 py-3">Credential</TableHead>
                <TableHead className="px-4 py-3">Default points</TableHead>
                <TableHead className="px-4 py-3">Referenced members</TableHead>
                <TableHead className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-800 bg-card">
              {credentials
                .filter((credential) =>
                  credential.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((credential) => (
                  <TableRow key={credential.id}>
                    <TableCell className="px-4 py-3 font-medium text-foreground">
                      {credential.name}
                      {credential.retiredOn && (
                        <span className="block text-xs text-warning">
                          Retires {credential.retiredOn}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 tabular-nums text-foreground">
                      {credential.fyPointsDefault}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-foreground">
                      {credential.holderCount}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <Button
                          type="button"
                          disabled={busy || dirty}
                          onClick={() => beginEdit(credential)}
                          className="text-sm font-medium text-info hover:text-info"
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void openHolders(credential)}
                          className="text-sm font-medium text-destructive hover:text-destructive"
                        >
                          View members
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Display-name changes preserve the stable credential identity used by existing policy and
          qualification evidence. Frozen sessions retain their original labels and scores.
        </p>
      </section>

      {holders !== null && holderCredentialId !== null && (
        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-label="Credential member references"
        >
          <h2 className="font-heading text-xl text-foreground">Member references</h2>
          <p className="mt-1 text-sm text-warning">
            These are legacy credential references, not proof of current qualification. Open each
            member’s effective-dated history to verify active, expired, or revoked status.
          </p>
          <ul className="mt-4 divide-y divide-slate-700">
            {holders.length === 0 ? (
              <li className="py-3 text-sm text-foreground">
                No members reference this credential.
              </li>
            ) : (
              holders.map((holder) => (
                <li
                  key={holder.memberId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="text-foreground">
                    {holder.firstName} {holder.lastName}{' '}
                    <span className="text-muted-foreground">{holder.employeeId}</span>
                  </span>
                  <Link
                    href={holder.historyHref as Route}
                    className="font-medium text-destructive hover:text-destructive"
                  >
                    Open qualification history
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>
      )}
    </section>
  );
}
