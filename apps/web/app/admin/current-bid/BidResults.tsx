'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { z } from 'zod';

const SessionSchema = z.object({
  id: z.string().min(1),
  isMock: z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .transform((value) => value === true || value === 1),
  currentPhase: z.string().min(1),
  startedAt: z.union([z.number(), z.string()]).nullable(),
});
const SessionsSchema = z.object({
  plan: z.object({ year: z.number().int(), sessions: z.array(SessionSchema) }),
});
const nullableText = z.string().nullable();
const ResultsSchema = z.object({
  session: z.object({
    id: z.string(),
    bidYear: z.number().int(),
    isMock: z.boolean(),
    currentPhase: z.string(),
    sequence: z.number().int().nonnegative().nullable(),
  }),
  awardSource: z.enum(['CANONICAL_UNAVAILABLE', 'CANONICAL']),
  provenance: z.object({
    valid: z.boolean(),
    error: nullableText,
    pin: z
      .object({
        v: z.literal(1),
        bidSessionId: z.string(),
        bidYear: z.number().int(),
        versionId: z.string(),
        versionSha256: z.string().regex(/^[a-f0-9]{64}$/),
        contextSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .nullable(),
    ruleBookVersion: nullableText,
    topologyReference: nullableText,
  }),
  awards: z.array(
    z.object({
      memberId: z.number().int().positive(),
      name: nullableText,
      positionId: z.string(),
      positionName: nullableText,
      shift: nullableText,
      station: nullableText,
      unit: nullableText,
      aDay: nullableText,
      memberships: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
      pool: z
        .object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(['STATION_POOL', 'FLOAT_POOL']),
          sourceRef: z.string(),
          sourceDecisionId: z.string(),
        })
        .nullable()
        .optional(),
    }),
  ),
  completion: z.object({ verified: z.boolean(), blockers: z.array(z.string()) }),
});
type Session = z.infer<typeof SessionSchema>;
type Results = z.infer<typeof ResultsSchema>;

async function read<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  signal: AbortSignal,
): Promise<z.output<T>> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      error.success ? error.data.error : `Results service returned ${response.status}.`,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error('Results service returned an invalid response.');
  return parsed.data;
}

function blockerLabel(code: string) {
  const labels: Record<string, string> = {
    mock_session_not_transitionable: 'Mock runs cannot become Department assignments.',
    annual_completion_required: 'The annual Bid has not reached verified completion.',
    annual_completion_receipt_required: 'A verified completion receipt is required.',
    frozen_policy_required: 'Verified frozen policy is required.',
    UNRESOLVED_MEMBERS_BLOCK_TRANSITION: 'Unresolved members block the assignment transition.',
    FINAL_A_DAY_MISSING: 'A final A-Day selection is missing.',
  };
  return labels[code] ?? code.replaceAll('_', ' ').toLowerCase();
}

function RunResults({
  year,
  session,
  generation,
}: { year: number; session: Session; generation: number }) {
  const [loaded, setLoaded] = useState<{
    results: Results | null;
    error: string | null;
    loading: boolean;
  }>({ results: null, error: null, loading: true });
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is the explicit user refresh trigger.
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoaded({ results: null, error: null, loading: true });
    void read(
      `/api/admin/bid-session/${encodeURIComponent(session.id)}/results`,
      ResultsSchema,
      controller.signal,
    )
      .then((results) => {
        const pin = results.provenance.pin;
        if (
          results.session.id !== session.id ||
          results.session.bidYear !== year ||
          results.session.isMock !== session.isMock ||
          (pin && (pin.bidSessionId !== session.id || pin.bidYear !== year)) ||
          (results.awardSource === 'CANONICAL_UNAVAILABLE' && results.awards.length > 0) ||
          (results.completion.verified &&
            (results.session.isMock || results.completion.blockers.length > 0))
        )
          throw new Error('Results do not match the selected run.');
        if (current) setLoaded({ results, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (current)
          setLoaded({
            results: null,
            error: error instanceof Error ? error.message : 'Results unavailable.',
            loading: false,
          });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [session.id, session.isMock, year, generation]);

  const results = loaded.results;
  const query = new URLSearchParams({ session_id: session.id }).toString();
  return (
    <div className="space-y-4">
      <p className="font-semibold">
        {session.isMock ? 'Mock rehearsal' : 'Live Bid'} · {session.id}
      </p>
      <nav aria-label="Selected run reports" className="flex flex-wrap gap-5 text-sm underline">
        <Link href={`/admin/exports?${query}` as Route}>Bid reports</Link>
        <Link href={`/admin/audit?${new URLSearchParams({ bid_session_id: session.id })}` as Route}>
          Decision history
        </Link>
        {!session.isMock ? (
          <Link href={`/admin/award-transition?${query}` as Route}>Review final assignments</Link>
        ) : null}
      </nav>
      {loaded.loading ? <output>Loading selected run results…</output> : null}
      {loaded.error ? <p role="alert">Results unavailable: {loaded.error}</p> : null}
      {results ? (
        <>
          <p>
            Phase: <strong>{results.session.currentPhase.replaceAll('_', ' ')}</strong>
            {results.session.sequence === null ? '' : ` · Sequence ${results.session.sequence}`}
          </p>
          <section
            aria-label="Completion and transition status"
            className="space-y-2 rounded border border-border p-3"
          >
            <h3 className="font-semibold">Completion and assignment transition</h3>
            <p>
              {results.completion.verified
                ? 'Official completion verified. Final assignments still require review in the assignment transition workflow.'
                : session.isMock
                  ? 'Mock results are rehearsal evidence.'
                  : 'Official completion is not verified.'}
            </p>
            {results.completion.blockers.length ? (
              <ul className="list-inside list-disc">
                {results.completion.blockers.map((code) => (
                  <li key={code}>{blockerLabel(code)}</li>
                ))}
              </ul>
            ) : null}
          </section>
          <details className="rounded border border-border p-3">
            <summary className="cursor-pointer font-semibold">
              Saved version and frozen source
            </summary>
            <dl className="mt-3 grid gap-2 break-all text-sm">
              <dt>Frozen policy</dt>
              <dd>
                {results.provenance.valid
                  ? 'Verified'
                  : `Unavailable${results.provenance.error ? `: ${results.provenance.error}` : ''}`}
              </dd>
              <dt>Rule book</dt>
              <dd>{results.provenance.ruleBookVersion ?? 'Unavailable'}</dd>
              <dt>Topology</dt>
              <dd>{results.provenance.topologyReference ?? 'Unavailable'}</dd>
              {results.provenance.pin ? (
                <>
                  <dt>Saved Bid version</dt>
                  <dd>{results.provenance.pin.versionId}</dd>
                  <dt>Saved content SHA-256</dt>
                  <dd>{results.provenance.pin.versionSha256}</dd>
                  <dt>Frozen context SHA-256</dt>
                  <dd>{results.provenance.pin.contextSha256}</dd>
                </>
              ) : (
                <>
                  <dt>Saved Bid version</dt>
                  <dd>No version pin was returned for this run.</dd>
                </>
              )}
            </dl>
          </details>
          <section aria-label="Recorded awards">
            <h3 className="font-semibold">Recorded awards</h3>
            {results.awardSource === 'CANONICAL_UNAVAILABLE' ? (
              <p className="mt-2 text-sm">
                Canonical awards are unavailable for this historical run. Its existing reports
                remain available above.
              </p>
            ) : results.awards.length === 0 ? (
              <p className="mt-2 text-sm">No awards have been recorded.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Shift / station</TableHead>
                      <TableHead>A-Day</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.awards.map((award) => (
                      <TableRow key={award.positionId}>
                        <TableCell>
                          {award.name ?? `Member ${award.memberId} (frozen name unavailable)`}
                          {award.memberships?.map((membership) => (
                            <span
                              key={membership.id}
                              className="block text-xs text-muted-foreground"
                            >
                              {membership.label}
                            </span>
                          ))}
                        </TableCell>
                        <TableCell>
                          {award.pool?.label ?? award.positionName ?? award.positionId}
                          <span className="block text-xs text-muted-foreground">
                            {award.positionId}
                            {award.unit ? ` · ${award.unit}` : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          {award.shift ?? 'Unavailable'} / {award.station ?? 'Unavailable'}
                        </TableCell>
                        <TableCell>{award.aDay ?? 'Not recorded'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function YearResults({ year }: { year: number }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [generation, setGeneration] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is the explicit user refresh trigger.
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setError(null);
    void read(`/api/admin/annual-plan/${year}`, SessionsSchema, controller.signal)
      .then((body) => {
        if (
          body.plan.year !== year ||
          new Set(body.plan.sessions.map((session) => session.id)).size !==
            body.plan.sessions.length
        )
          throw new Error('Run listing does not match this Bid year.');
        if (current) setSessions(body.plan.sessions);
      })
      .catch((cause: unknown) => {
        if (current) {
          setSessions(null);
          setError(cause instanceof Error ? cause.message : 'Run listing unavailable.');
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [year, generation]);
  const selected = sessions?.find((session) => session.id === selectedId);
  return (
    <section aria-label="Bid results" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Results</h2>
        <Button type="button" onClick={() => setGeneration((value) => value + 1)}>
          Refresh results
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Choose a saved run to review its recorded awards and completion evidence.
      </p>
      {error ? (
        <p role="alert">Run listing unavailable: {error}</p>
      ) : sessions === null ? (
        <output>Loading runs…</output>
      ) : sessions.length === 0 ? (
        <p>No runs are available for {year}.</p>
      ) : (
        <Label className="block">
          Bid run
          <NativeSelect
            aria-label="Bid run"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="mt-1 block w-full"
          >
            <option value="">Select a run</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.isMock ? 'Mock' : 'Live'} · {session.id}
              </option>
            ))}
          </NativeSelect>
        </Label>
      )}
      {selected ? (
        <RunResults key={selected.id} year={year} session={selected} generation={generation} />
      ) : null}
    </section>
  );
}

export function BidResults({ year }: { year: number }) {
  return <YearResults key={year} year={year} />;
}
