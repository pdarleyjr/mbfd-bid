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
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useRetainedMutation } from '@/lib/use-retained-mutation';

import { type FormEvent, useState } from 'react';

interface ReviewBatch {
  id: string;
  source_system: string;
  source_reference: string;
  status: string;
  total: number;
  needsReview: number;
  applied: number;
}

interface ReviewRow {
  id: string;
  sourceMemberReference: string;
  sourceCredentialReference: string;
  sourceStatus: string;
  effectiveOn: string | null;
  expiresOn: string | null;
  provenance: string;
  classification: string;
  decision: 'accepted' | 'rejected' | 'needs_review' | null;
  appliedEventId: string | null;
}

interface BatchDetail {
  batch: { id: string; source_system: string; source_reference: string; status: string };
  rows: ReviewRow[];
  annualEligibility: 'PENDING_CONFIGURATION';
}

async function responseDetail(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body !== null && typeof body === 'object' && 'error' in body
    ? String((body as { error: unknown }).error)
    : `Request failed (${response.status}).`;
}

export function QualificationReviewWorkspace({
  initialBatches,
}: { initialBatches: ReviewBatch[] }) {
  const refreshProjections = usePersonnelProjectionRefresh();
  const staging = useRetainedMutation<{ batch: string; row: string }>('qualification-stage');
  const applying = useRetainedMutation<string>('qualification-apply');
  const [batches, setBatches] = useState(initialBatches);
  const [selected, setSelected] = useState<BatchDetail | null>(null);
  const [sourceSystem, setSourceSystem] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [memberReference, setMemberReference] = useState('');
  const [credentialReference, setCredentialReference] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [provenance, setProvenance] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadBatch(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/qualification-lifecycle/reviews/batches/${id}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await responseDetail(response));
      setSelected((await response.json()) as BatchDetail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Review batch could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function createAndStage(event: FormEvent<HTMLFormElement>) {
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        batch: JSON.stringify({
          source_system: sourceSystem.trim(),
          source_reference: sourceReference.trim(),
        }),
        row: JSON.stringify({
          source_member_reference: memberReference.trim(),
          source_credential_reference: credentialReference.trim(),
          source_status: 'active',
          effective_on: effectiveOn || undefined,
          expires_on: expiresOn || null,
          provenance: provenance.trim(),
        }),
      };
      const request = staging.prepare(JSON.stringify(payload), () => payload);
      const batchResponse = await csrfFetch('/api/admin/qualification-lifecycle/reviews/batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${request.key}-batch`,
        },
        credentials: 'include',
        body: request.payload.batch,
      });
      if (!batchResponse.ok) throw new Error(await responseDetail(batchResponse));
      const batchBody = (await batchResponse.json()) as { batchId: string };
      const stageResponse = await csrfFetch(
        `/api/admin/qualification-lifecycle/reviews/batches/${batchBody.batchId}/rows`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${request.key}-row`,
          },
          credentials: 'include',
          body: request.payload.row,
        },
      );
      if (!stageResponse.ok) throw new Error(await responseDetail(stageResponse));
      staging.accepted(request.key);
      setBatches((current) => [
        {
          id: batchBody.batchId,
          source_system: sourceSystem.trim(),
          source_reference: sourceReference.trim(),
          status: 'staged',
          total: 1,
          needsReview: 1,
          applied: 0,
        },
        ...current.filter((batch) => batch.id !== batchBody.batchId),
      ]);
      await loadBatch(batchBody.batchId);
      setNotice(
        'The source row is staged. Review its classification before accepting and applying it.',
      );
      setMemberReference('');
      setCredentialReference('');
      setEffectiveOn('');
      setExpiresOn('');
      setProvenance('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Review batch could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(row: ReviewRow, decision: 'accepted' | 'rejected' | 'needs_review') {
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    setBusy(true);
    setError(null);
    try {
      const response = await csrfFetch(
        `/api/admin/qualification-lifecycle/reviews/rows/${row.id}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) throw new Error(await responseDetail(response));
      if (selected !== null) await loadBatch(selected.batch.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Review decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function apply(row: ReviewRow) {
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    setBusy(true);
    setError(null);
    try {
      const request = applying.prepare(row.id, () =>
        JSON.stringify({ reason: `Operator applied accepted review row ${row.id}.` }),
      );
      const response = await csrfFetch(
        `/api/admin/qualification-lifecycle/reviews/rows/${row.id}/apply`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': request.key,
          },
          credentials: 'include',
          body: request.payload,
        },
      );
      if (!response.ok) throw new Error(await responseDetail(response));
      applying.accepted(request.key);
      await refreshProjections('qualification');
      if (selected !== null) await loadBatch(selected.batch.id);
      setNotice(
        'Accepted evidence was applied to the canonical qualification ledger. Annual Bid eligibility remains pending separate configuration.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Qualification apply could not be completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="rounded border border-warning/40 bg-warning-surface px-4 py-3 text-sm text-warning">
        Current qualification evidence is not frozen annual-Bid eligibility. Every applied row
        remains <strong>PENDING_CONFIGURATION</strong> for annual adjudication.
      </p>
      <form
        onSubmit={createAndStage}
        className="grid gap-4 rounded-xl border border-border bg-card p-5 lg:grid-cols-2"
      >
        <h2 className="lg:col-span-2 font-heading text-xl text-foreground">
          Stage source evidence
        </h2>
        <Field label="Source system" value={sourceSystem} onChange={setSourceSystem} required />
        <Field
          label="Source reference"
          value={sourceReference}
          onChange={setSourceReference}
          required
        />
        <Field
          label="Authoritative member reference"
          value={memberReference}
          onChange={setMemberReference}
          required
        />
        <Field
          label="Credential reference"
          value={credentialReference}
          onChange={setCredentialReference}
          required
        />
        <Field
          label="Effective date"
          type="date"
          value={effectiveOn}
          onChange={setEffectiveOn}
          required
        />
        <Field
          label="Expiration date (optional)"
          type="date"
          value={expiresOn}
          onChange={setExpiresOn}
        />
        <div className="lg:col-span-2">
          <Field label="Provenance" value={provenance} onChange={setProvenance} required />
        </div>
        <div className="lg:col-span-2">
          <Button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded bg-destructive px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Stage for review'}
          </Button>
        </div>
      </form>
      {error !== null && (
        <output aria-live="assertive" className="block text-sm text-destructive">
          {error}
        </output>
      )}
      {notice !== null && (
        <output aria-live="polite" className="block text-sm text-success">
          {notice}
        </output>
      )}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-xl text-foreground">Review batches</h2>
          <span className="text-xs text-muted-foreground">{batches.length} batch(es)</span>
        </div>
        {batches.length === 0 ? (
          <p className="mt-4 text-sm text-foreground">
            No staged qualification batches exist. Stage authoritative evidence above; no match is
            inferred without an authoritative member reference.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <TableHeader className="text-xs uppercase text-muted-foreground">
                <TableRow>
                  <TableHead className="pb-2">Source</TableHead>
                  <TableHead className="pb-2">Status</TableHead>
                  <TableHead className="pb-2">Exceptions</TableHead>
                  <TableHead className="pb-2">Applied</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id} className="border-t border-border">
                    <TableCell className="py-3 text-foreground">
                      {batch.source_system}
                      <div className="font-mono text-xs text-muted-foreground">
                        {batch.source_reference}
                      </div>
                    </TableCell>
                    <TableCell>{batch.status}</TableCell>
                    <TableCell>{batch.needsReview}</TableCell>
                    <TableCell>
                      {batch.applied}/{batch.total}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        onClick={() => void loadBatch(batch.id)}
                        className="text-info hover:text-info"
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {selected !== null && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-heading text-xl text-foreground">Exception-first row review</h2>
          <p className="mt-1 text-sm text-foreground">
            {selected.batch.source_system} · {selected.batch.source_reference}
          </p>
          <div className="mt-4 space-y-3">
            {selected.rows.map((row) => (
              <article key={row.id} className="border-t border-border pt-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {row.sourceMemberReference} · {row.sourceCredentialReference}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {row.classification} · {row.sourceStatus} ·{' '}
                      {row.effectiveOn ?? 'no effective date'} · {row.provenance}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.appliedEventId !== null ? (
                      <span className="text-xs text-success">Applied</span>
                    ) : (
                      <>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(row, 'needs_review')}
                          className="text-xs text-warning"
                        >
                          Needs review
                        </Button>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(row, 'rejected')}
                          className="text-xs text-foreground"
                        >
                          Reject
                        </Button>
                        <Button
                          type="button"
                          disabled={busy || row.decision === 'accepted'}
                          onClick={() => void decide(row, 'accepted')}
                          className="text-xs text-info"
                        >
                          Accept
                        </Button>
                        {row.decision === 'accepted' && (
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => void apply(row)}
                            className="text-xs font-semibold text-success"
                          >
                            Explicit apply
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <Label className="block">
      <span className="text-sm text-foreground">{label}</span>
      <Input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
      />
    </Label>
  );
}
