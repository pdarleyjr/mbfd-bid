'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { BidOrdinalImportSchema } from '@mbfd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { annualGet, annualPost } from '../../annual-plan/annual-plan-client';
import { useBidMembers } from '../../current-bid/BidFields';

type OrdinalImport = ReturnType<typeof BidOrdinalImportSchema.parse>;
type Tour = {
  id: string;
  revision: number;
  effectiveOn: string;
  completedDaysTour: number | null;
  sourceRef: string;
};
export function BidEvidenceWorkspace({ initialMemberId = '' }: { initialMemberId?: string }) {
  const client = useQueryClient();
  const people = useBidMembers();
  const [memberId, setMemberId] = useState(initialMemberId);
  const [year, setYear] = useState(new Date().getFullYear());
  const [candidate, setCandidate] = useState<OrdinalImport | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [effectiveOn, setEffectiveOn] = useState('');
  const [completed, setCompleted] = useState('unknown');
  const [sourceRef, setSourceRef] = useState('');
  const [reason, setReason] = useState('');
  const [tourBaseRevision, setTourBaseRevision] = useState<number | null>(null);
  const uploadGeneration = useRef(0);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const ordinals = useQuery({
    queryKey: ['admin', 'bid-ordinals', year],
    queryFn: () =>
      annualGet<{
        dataset: {
          id: string;
          revision: number;
          sourceRef: string;
          sourceSha256: string;
          entries: unknown[];
        } | null;
      }>(`bid-ordinals/${year}`),
  });
  const tours = useQuery({
    queryKey: ['admin', 'bid-tour-evidence', memberId],
    enabled: /^[1-9]\d*$/.test(memberId),
    queryFn: () => annualGet<{ records: Tour[] }>(`bid-tour-evidence/${memberId}`),
  });
  const latestTourRevision = tours.data?.records[0]?.revision ?? 0;
  const tourChanged = tourBaseRevision !== null && tourBaseRevision !== latestTourRevision;
  function editTour(change: () => void) {
    if (!tours.data) return;
    setTourBaseRevision((current) => current ?? latestTourRevision);
    change();
  }
  function clearTourDraft() {
    setTourBaseRevision(null);
    setEffectiveOn('');
    setSourceRef('');
    setReason('');
    setCompleted('unknown');
  }
  async function save(path: string, body: unknown) {
    const fingerprint = JSON.stringify({ path, body });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setMessage('');
    try {
      await annualPost(path, body, pending.current.key);
      pending.current = null;
      setCandidate(null);
      if (path === 'bid-tour-evidence') clearTourDraft();
      await client.invalidateQueries({ queryKey: ['admin', 'bid-ordinals'] });
      await client.invalidateQueries({ queryKey: ['admin', 'bid-tour-evidence'] });
      setMessage('Reviewed evidence saved. Existing personnel dates and Bid history are retained.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Evidence could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="font-heading text-3xl">Bid evidence</h1>
      <p>
        Keep annual source-certified rankings and completed tour evidence separate from personnel
        dates.
      </p>
      {message ? <output className="block">{message}</output> : null}
      <section className="space-y-4 rounded border p-4" aria-label="Source-certified Bid ordinals">
        <h2 className="text-xl font-semibold">Source-certified Bid ordinals</h2>
        <Label>
          Bid year
          <Input
            type="number"
            min={2024}
            max={2100}
            value={year}
            onChange={(event) => {
              uploadGeneration.current += 1;
              setYear(Number(event.target.value));
              setCandidate(null);
            }}
          />
        </Label>
        {ordinals.error ? <p role="alert">{ordinals.error.message}</p> : null}
        {ordinals.data?.dataset ? (
          <p>
            Revision {ordinals.data.dataset.revision}: {ordinals.data.dataset.entries.length}{' '}
            reviewed identities. Source: {ordinals.data.dataset.sourceRef}
          </p>
        ) : (
          <p>No reviewed ordinal dataset is loaded.</p>
        )}
        <p>
          Upload the reviewed JSON mapping with stable employee and member IDs, source SHA-256,
          source reference, reason and expected revision. Rank Seniority means time-in-grade Bid
          ordinal; Straight Seniority means department-service Bid ordinal.
        </p>
        <Label>
          Reviewed ordinal mapping
          <Input
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const generation = ++uploadGeneration.current;
              setCandidate(null);
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const result = BidOrdinalImportSchema.safeParse(JSON.parse(await file.text()));
                if (generation !== uploadGeneration.current) return;
                if (!result.success)
                  throw new Error(
                    'Mapping requires unique identities and positive integer ordinals with complete source evidence.',
                  );
                if (result.data.bidYear !== year)
                  throw new Error('Mapping Bid year differs from the selected year.');
                setCandidate(result.data);
                setMessage('Review the source and member count before saving.');
              } catch (error) {
                if (generation !== uploadGeneration.current) return;
                setMessage(error instanceof Error ? error.message : 'Mapping could not be read.');
              }
            }}
          />
        </Label>
        {candidate ? (
          <div className="space-y-2">
            <p>
              {candidate.entries.length} unique members; expected revision{' '}
              {candidate.expectedRevision}. Source: {candidate.sourceRef}
            </p>
            <p className="break-all">SHA-256: {candidate.sourceSha256}</p>
            <p>{candidate.reason}</p>
            <Button
              disabled={
                busy ||
                !ordinals.data ||
                candidate.bidYear !== year ||
                candidate.expectedRevision !== (ordinals.data.dataset?.revision ?? 0)
              }
              onClick={() => {
                if (candidate.bidYear === year) void save('bid-ordinals', candidate);
              }}
            >
              Save reviewed Bid ordinals
            </Button>
          </div>
        ) : null}
      </section>
      <section
        className="space-y-4 rounded border p-4"
        aria-label="Completed Days Bid tour evidence"
      >
        <h2 className="text-xl font-semibold">Completed Days Bid tour evidence</h2>
        <p>
          Record whether the member has completed a full Days Bid tour. Current assignment or
          elapsed service alone does not establish this fact.
        </p>
        <Label>
          Member
          <NativeSelect
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
              clearTourDraft();
            }}
          >
            <option value="">Choose a member</option>
            {(people.data ?? []).map((person) => (
              <option key={person.value} value={person.value}>
                {person.label}
              </option>
            ))}
          </NativeSelect>
        </Label>
        {tours.error ? <p role="alert">{tours.error.message}</p> : null}
        {tourChanged ? (
          <div role="alert">
            <p>
              Tour evidence changed while this review was open. Review the latest record before
              saving.
            </p>
            <Button onClick={clearTourDraft}>Discard draft and review latest tour evidence</Button>
          </div>
        ) : null}
        {(tours.data?.records ?? []).map((row) => (
          <p key={row.id}>
            Revision {row.revision} · {row.effectiveOn} ·{' '}
            {row.completedDaysTour === null
              ? 'Unknown'
              : row.completedDaysTour === 1
                ? 'Completed a full Days tour'
                : 'No completed full Days tour'}{' '}
            · {row.sourceRef}
          </p>
        ))}
        <Label>
          Effective date
          <Input
            type="date"
            value={effectiveOn}
            onChange={(event) => editTour(() => setEffectiveOn(event.target.value))}
          />
        </Label>
        <Label>
          Reviewed finding
          <NativeSelect
            value={completed}
            onChange={(event) => editTour(() => setCompleted(event.target.value))}
          >
            <option value="unknown">Unknown</option>
            <option value="yes">Has completed a full Days Bid tour</option>
            <option value="no">Has not completed a full Days Bid tour</option>
          </NativeSelect>
        </Label>
        <Label>
          Source reference
          <Input
            value={sourceRef}
            onChange={(event) => editTour(() => setSourceRef(event.target.value))}
          />
        </Label>
        <Label>
          Reason
          <Input
            value={reason}
            onChange={(event) => editTour(() => setReason(event.target.value))}
          />
        </Label>
        <Button
          disabled={
            busy ||
            !tours.data ||
            tourBaseRevision === null ||
            tourChanged ||
            !effectiveOn ||
            sourceRef.trim().length < 4 ||
            reason.trim().length < 4
          }
          onClick={() =>
            void save('bid-tour-evidence', {
              memberId: Number(memberId),
              expectedRevision: tourBaseRevision,
              effectiveOn,
              completedDaysTour: completed === 'unknown' ? null : completed === 'yes',
              sourceRef,
              reason,
            })
          }
        >
          Save reviewed tour evidence
        </Button>
      </section>
    </div>
  );
}
