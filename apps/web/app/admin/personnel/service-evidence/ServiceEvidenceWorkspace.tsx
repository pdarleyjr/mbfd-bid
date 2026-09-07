'use client';
import { RetainedEvidenceReview } from '@/components/admin/RetainedEvidenceReview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  annualGet,
  annualPost,
  buttonClass,
  fieldClass,
} from '../../annual-plan/annual-plan-client';
type RecordRow = {
  id: string;
  memberId: number;
  serviceCode: string;
  revision: number;
  effectiveOn: string;
  verifiedMonths: number | null;
  sourceRef: string;
  reason: string;
  actorSubject: string;
};
export function ServiceEvidenceWorkspace() {
  const client = useQueryClient();
  const [member, setMember] = useState('');
  const [service, setService] = useState('');
  const [effective, setEffective] = useState('');
  const [months, setMonths] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const [expected, setExpected] = useState<number | null>(null);
  const dirty = !!(service || effective || months || unknown || source || reason);
  useUnsavedChanges(dirty, 'service evidence');
  const members = useQuery({
    queryKey: ['admin', 'service-evidence', 'member-options'],
    staleTime: 30_000,
    queryFn: async () => {
      const rows: { id: number; firstName: string; lastName: string; employeeId: string }[] = [];
      let total = 1;
      while (rows.length < total) {
        const result = await annualGet<{ members: typeof rows; total: number }>(
          `members?limit=100&offset=${rows.length}`,
        );
        if (!result.members.length && rows.length < result.total)
          throw new Error('Member list incomplete');
        rows.push(...result.members);
        total = result.total;
      }
      return rows;
    },
  });
  const types = useQuery({
    queryKey: ['admin', 'service-evidence', 'types'],
    staleTime: 30_000,
    queryFn: () => annualGet<{ types: { id: string; name: string }[] }>('service-evidence/types'),
  });
  const records = useQuery({
    queryKey: ['admin', 'service-evidence', 'records', member],
    enabled: !!member,
    staleTime: 30_000,
    queryFn: () => annualGet<{ records: RecordRow[] }>(`service-evidence?member_id=${member}`),
  });
  function clear() {
    setService('');
    setEffective('');
    setMonths('');
    setUnknown(false);
    setSource('');
    setReason('');
    setExpected(null);
    pending.current = null;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (expected === null) return;
    setBusy(true);
    setMessage('');
    const body = {
      member_id: Number(member),
      service_code: service,
      expected_revision: expected,
      effective_on: effective,
      verified_months: unknown ? null : Number(months),
      source_ref: source,
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost('service-evidence', body, pending.current.key);
      clear();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'service-evidence'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
      ]);
      setMessage(
        'Dated service evidence recorded. Existing frozen sessions retain their prior evidence.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Service evidence failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-5 text-foreground">
      <header>
        <h1 className="font-heading text-3xl">Service Evidence</h1>
        <p className="mt-2 text-sm text-foreground">
          Record verified cumulative completed months from an authoritative source. These are
          reviewed totals, not a calculation from current assignments. Use unknown when the evidence
          is unresolved.
        </p>
      </header>
      <Label className="block">
        Member
        <NativeSelect
          className={fieldClass}
          value={member}
          disabled={dirty || busy}
          onChange={(e) => setMember(e.target.value)}
        >
          <option value="">Choose member</option>
          {members.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName} {m.lastName} · {m.employeeId}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {(members.isError || types.isError || records.isError) && (
        <p role="alert" className="text-warning">
          Reference data could not be refreshed. Your edits remain in the form.
        </p>
      )}
      <details className="rounded border border-border p-4">
        <summary className="cursor-pointer font-semibold">Add a service category</summary>
        <ServiceTypeCreator />
      </details>
      <form onSubmit={save} className="space-y-4">
        <fieldset
          disabled={!member || records.isPending || records.isError || busy}
          className="space-y-4"
        >
          <Label className="block">
            Service category
            <NativeSelect
              required
              className={fieldClass}
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                setExpected(
                  Math.max(
                    0,
                    ...(records.data?.records
                      .filter((r) => r.serviceCode === e.target.value)
                      .map((r) => r.revision) ?? []),
                  ),
                );
              }}
            >
              <option value="">Choose category</option>
              {types.data?.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label>
              Effective date of this evidence
              <Input
                required
                type="date"
                className={fieldClass}
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
            </Label>
            <Label>
              Verified cumulative completed months
              <Input
                required={!unknown}
                disabled={unknown}
                type="number"
                min={0}
                max={1200}
                className={fieldClass}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </Label>
          </div>
          <Label className="flex min-h-11 items-center gap-3">
            <Input
              type="checkbox"
              checked={unknown}
              onChange={(e) => setUnknown(e.target.checked)}
            />
            Cumulative service is unknown and requires review
          </Label>
          <Label className="block">
            Authoritative source reference
            <Input
              required
              minLength={4}
              maxLength={500}
              className={fieldClass}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Label>
          <Label className="block">
            Review reason
            <Input
              required
              minLength={4}
              maxLength={500}
              className={fieldClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Label>
          <Button type="submit" className={buttonClass}>
            {busy ? 'Saving…' : 'Record reviewed service evidence'}
          </Button>
          <Button type="button" className={`${buttonClass} ml-3`} disabled={!dirty} onClick={clear}>
            Discard edits
          </Button>
        </fieldset>
      </form>
      {dirty && service && (
        <RetainedEvidenceReview
          key={`${member}:${service}`}
          disabled={busy}
          load={async () => {
            const fresh = await records.refetch();
            if (fresh.error || !fresh.data)
              throw new Error('Service history could not be refreshed');
            const value = Math.max(
              0,
              ...fresh.data.records.filter((r) => r.serviceCode === service).map((r) => r.revision),
            );
            return { value, label: `Service revision ${value}` };
          }}
          useRevision={(value) => {
            setExpected(value);
            pending.current = null;
          }}
        />
      )}
      {message && <output className="block rounded border border-border p-3">{message}</output>}
      <section className="space-y-3">
        <h2 className="font-heading text-xl">Evidence history</h2>
        {records.data?.records.map((r) => (
          <article key={r.id} className="rounded border border-border p-4">
            <h3 className="font-semibold">
              {types.data?.types.find((t) => t.id === r.serviceCode)?.name ?? r.serviceCode} ·
              Revision {r.revision}
            </h3>
            <p className="mt-1">
              {r.verifiedMonths === null ? 'Unknown' : `${r.verifiedMonths} completed months`} ·
              Effective {r.effectiveOn}
            </p>
            <p className="mt-2 break-words text-sm text-foreground">Source: {r.sourceRef}</p>
            <p className="text-sm text-muted-foreground">
              {r.reason} · Recorded by {r.actorSubject}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}

function ServiceTypeCreator() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  useUnsavedChanges(!!(name || source || reason), 'service category edits');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = { name, source_ref: source, reason };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost('service-evidence/types', body, pending.current.key);
      setName('');
      setSource('');
      setReason('');
      pending.current = null;
      await client.invalidateQueries({ queryKey: ['admin', 'service-evidence', 'types'] });
      setMessage(
        'Service category created. It grants no member credit or annual eligibility by itself.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Category could not be saved');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="mt-4 space-y-3" onSubmit={save}>
      <Label className="block">
        Category name
        <Input
          required
          minLength={2}
          maxLength={160}
          className={fieldClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Label>
      <Label className="block">
        Policy source reference
        <Input
          required
          minLength={4}
          maxLength={500}
          className={fieldClass}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </Label>
      <Label className="block">
        Reason
        <Input
          required
          minLength={4}
          maxLength={500}
          className={fieldClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Label>
      <Button type="submit" className={buttonClass} disabled={busy}>
        Create service category
      </Button>
      {message && <output className="block text-sm">{message}</output>}
    </form>
  );
}
