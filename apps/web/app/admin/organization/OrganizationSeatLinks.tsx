'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

export function OrganizationSeatLinks({
  asOf,
  units,
}: { asOf: string; units: { id: string; name: string; status: string }[] }) {
  const client = useQueryClient();
  const [seat, setSeat] = useState('');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  useUnsavedChanges(!!(seat || unit || reason || evidence), 'seat-link edits');
  const roster = useQuery({
    queryKey: ['admin', 'current-roster', asOf],
    enabled: !!asOf,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetch(`/api/admin/current-roster?as_of=${asOf}`, { credentials: 'include' });
      if (!r.ok) throw new Error('Seats unavailable');
      return (await r.json()) as { positions: { id: string; stableSlotKey: string }[] };
    },
  });
  const links = useQuery({
    queryKey: ['admin', 'organization', 'seat-links', asOf],
    enabled: !!asOf,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetch(`/api/admin/organization/seats/links?as_of=${asOf}`, {
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Seat links unavailable');
      return (await r.json()) as {
        links: {
          staffingPositionId: string;
          organizationUnitId: string | null;
          revision: number;
          latestRevision: number;
        }[];
      };
    },
  });
  const [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  const selected = links.data?.links.find((l) => l.staffingPositionId === seat);
  const input =
    'mt-1 min-h-11 w-full min-w-0 rounded border border-border bg-card px-3 text-foreground';
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (expectedRevision === null) return;
    setBusy(true);
    setMessage(null);
    const body = {
      organization_unit_id: unit || null,
      effective_on: asOf,
      expected_revision: expectedRevision,
      evidence_ref: evidence,
      reason,
    };
    const fingerprint = JSON.stringify({ seat, body });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await createCsrfAwareFetch(fetch, () => window.location.origin)(
        `/api/admin/organization/seats/${encodeURIComponent(seat)}/link`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error((result.error ?? 'Seat link rejected').replaceAll('_', ' '));
      setMessage(
        'Reviewed organizational link saved. Canonical occupancy remains attached to the same seat.',
      );
      setSeat('');
      setUnit('');
      setReason('');
      setEvidence('');
      setExpectedRevision(null);
      pending.current = null;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'organization'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
        invalidateWorkingBidBoards(client),
      ]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Seat link service unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-border p-5">
      <h2 className="font-heading text-xl">Link a reviewed seat to organization</h2>
      <p className="mt-2 text-sm text-foreground">
        Use an explicit reviewed association effective on {asOf}. This links an existing seat; it
        does not create a seat or assign a member.
      </p>
      {(roster.isError || links.isError) && (
        <p role="alert" className="mt-3 text-warning">
          Seat references could not be loaded.
        </p>
      )}
      <form onSubmit={save} className="mt-4 grid gap-4 md:grid-cols-2">
        <Label className="text-sm">
          Authorized seat
          <NativeSelect
            required
            className={input}
            value={seat}
            onChange={(e) => {
              setSeat(e.target.value);
              const link = links.data?.links.find((l) => l.staffingPositionId === e.target.value);
              setUnit(link?.organizationUnitId ?? '');
              setExpectedRevision(link?.revision ?? null);
            }}
          >
            <option value="">Select existing seat</option>
            {roster.data?.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.stableSlotKey}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="text-sm">
          Organization association
          <NativeSelect value={unit} onChange={(e) => setUnit(e.target.value)} className={input}>
            <option value="">Remove association / Review required</option>
            {units
              .filter((u) => u.status === 'active')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <Label className="text-sm">
          Link evidence reference
          <Input
            required
            minLength={4}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            className={input}
          />
        </Label>
        <Label className="text-sm">
          Link reason
          <Input
            required
            minLength={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={input}
          />
        </Label>
        {selected && selected.latestRevision !== expectedRevision && (
          <p role="alert" className="text-warning md:col-span-2">
            This seat has a later link revision. Review its date before editing.
          </p>
        )}
        <Button
          disabled={
            busy || expectedRevision === null || selected?.latestRevision !== expectedRevision
          }
          className="min-h-11 justify-self-start rounded bg-destructive px-4 font-semibold text-primary-foreground disabled:opacity-50"
          type="submit"
        >
          {busy ? 'Saving…' : 'Save reviewed link'}
        </Button>
      </form>
      {message && <output className="mt-3 block text-sm text-warning">{message}</output>}
    </section>
  );
}
