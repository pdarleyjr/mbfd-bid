'use client';

import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import type {
  AirTechReference,
  MemberBidFormResponse,
  MemberRankReference,
} from '../../../../../worker/src/lib/bid-form-source';

type FormState = { key: string; data: MemberBidFormResponse | null; error: string | null };

/** Submitted preferences are read-only decision support, never an award command. */
export function useMemberBidForm({
  sessionId,
  year,
  memberId,
  enabled,
}: {
  sessionId?: string | undefined;
  year?: number | null | undefined;
  memberId: number;
  enabled: boolean;
}) {
  const key = JSON.stringify([sessionId, year, memberId]);
  const [state, setState] = useState<FormState | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    void retry;
    if (!enabled || !sessionId || !year) return;
    let active = true;
    const controller = new AbortController();
    setState(null);
    void fetch(
      `/api/admin/bid-forms/${year}/members/${memberId}?${new URLSearchParams({ session_id: sessionId })}`,
      {
        cache: 'no-store',
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Submitted bid information could not be loaded.');
        const data = (await response.json()) as MemberBidFormResponse;
        if (data.memberId !== memberId || data.sessionId !== sessionId || data.year !== year)
          throw new Error('Submitted bid information did not match this member and bid.');
        return data;
      })
      .then((data) => {
        if (active) setState({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            key,
            data: null,
            error:
              error instanceof Error ? error.message : 'Submitted bid information is unavailable.',
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, sessionId, year, memberId, key, retry]);
  return {
    current: state?.key === key ? state : null,
    retry: () => setRetry((value) => value + 1),
  };
}

export function BidMemberForm({
  current,
  retry,
  hasSession,
}: {
  current: FormState | null;
  retry: () => void;
  hasSession: boolean;
}) {
  if (!hasSession)
    return (
      <p className="text-sm text-muted-foreground">
        Open a saved bid to view its member’s submitted form.
      </p>
    );
  if (!current)
    return (
      <output className="text-sm text-muted-foreground">Loading submitted bid information…</output>
    );
  if (current.error)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-warning">
          {current.error}
        </p>
        <Button type="button" onClick={retry}>
          Retry bid information
        </Button>
      </div>
    );
  const data = current.data;
  if (!data) return null;
  const form = data.form;
  const emptyMessages = {
    NOT_SUBMITTED: 'This member is listed as not having submitted a bid form.',
    NOT_LISTED: 'This member is not listed in the supplied bid forms.',
    IDENTITY_REVIEW: 'This form needs an identity review before its preferences can be shown.',
    SOURCE_UNAVAILABLE: 'Bid forms have not been published for this year.',
  };
  return (
    <div className="space-y-5 text-sm">
      {data.status === 'SUBMITTED' && form ? (
        <>
          <div>
            <h3 className="font-semibold">Submitted preferences</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              These are the member’s requested units. Choose the actual seat on the bid board.
            </p>
          </div>
          <section aria-label="Submitted position preferences">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Position choices</h4>
            {form.positionPreferences.length ? (
              <ol className="divide-y divide-border">
                {form.positionPreferences.map((choice) => (
                  <li key={choice.order} className="flex gap-3 py-2">
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground">
                      {choice.order}.
                    </span>
                    <span className="min-w-0 break-words">
                      {choice.shift} · {choice.unit}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No position choices recorded.</p>
            )}
          </section>
          <section aria-label="Submitted A-Day preferences">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">A-Day choices</h4>
            {form.aDayPreferences.length ? (
              <ol className="divide-y divide-border">
                {form.aDayPreferences.map((choice) => (
                  <li key={choice.order} className="flex gap-3 py-2">
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground">
                      {choice.order}.
                    </span>
                    <span className="min-w-0 break-words">
                      {choice.shift && choice.group
                        ? `${choice.shift === 'D' ? 'Days' : `${choice.shift} shift`} · ${choice.group.replace(/^G(\d+)$/, 'Group $1')}`
                        : choice.sourceLabel}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No A-Day choices recorded.</p>
            )}
          </section>
          <p>Teams attendance: {form.attendingTeams || 'Not recorded'}</p>
          {form.phone1 || form.phone2 ? (
            <details>
              <summary className="min-h-11 cursor-pointer content-center font-semibold">
                Contact information
              </summary>
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Primary phone</dt>
                <dd className="break-words">{form.phone1 ?? 'Not recorded'}</dd>
                <dt className="text-muted-foreground">Second phone</dt>
                <dd className="break-words">{form.phone2 ?? 'Not recorded'}</dd>
              </dl>
            </details>
          ) : null}
          {form.identityResolution ? (
            <div className="space-y-1 rounded border border-warning/40 bg-warning/5 p-3 text-xs">
              <p className="font-semibold">Reviewed employee ID correction</p>
              <p>
                Form ID {form.employeeId} · matched employee {form.identityResolution.employeeId}
              </p>
              <p className="break-words">{form.identityResolution.discrepancy}</p>
            </div>
          ) : null}
        </>
      ) : (
        <output>
          {data.status === 'SUBMITTED'
            ? 'The submitted form is unavailable.'
            : emptyMessages[data.status]}
        </output>
      )}
      {data.source ? (
        <details className="border-t border-border pt-2">
          <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold">
            Form source
          </summary>
          <div className="space-y-1 break-words text-xs text-muted-foreground">
            <p>
              {data.source.name}
              {data.sourceLocation
                ? ` · ${data.sourceLocation.sheet}, row ${data.sourceLocation.row}`
                : ''}
            </p>
            {form ? (
              <p>
                Submitted as {form.sourceRank} {form.sourceName} · employee {form.employeeId}
              </p>
            ) : null}
            <p>Source SHA-256: {data.source.sha256}</p>
            {form?.identityResolution ? (
              <p>
                Correction: {form.identityResolution.source.name} ·{' '}
                {form.identityResolution.sourceLocation} · {form.identityResolution.source.sha256}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
      <PublishedRankReferences references={data.rankReferences} />
    </div>
  );
}

export function SpecialtyReference({
  reference,
  rankReferences,
}: {
  reference: AirTechReference | null | undefined;
  rankReferences?: readonly MemberRankReference[] | undefined;
}) {
  if (rankReferences?.length) return <PublishedRankReferences references={rankReferences} />;
  if (!reference) return null;
  return (
    <details className="border-t border-border pt-3 text-sm">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        Published specialty reference · {reference.totalPoints} points
      </summary>
      <p className="mb-3 text-xs text-muted-foreground">
        Published bid order {reference.bidOrder}. This reference does not change credentials or this
        bid’s saved eligibility.
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
        {(
          [
            ['Driver Engineer', reference.driverEngineerPoints],
            ['AirTech', reference.airTechPoints],
            ['Car seat', reference.carSeatPoints],
            ['Drone', reference.dronePoints],
            ['Operations', reference.operationsPoints],
            ['Technician', reference.technicianPoints],
            ['Total', reference.totalPoints],
            ['Rank seniority', reference.rankSeniority],
          ] as const
        ).map(([label, points]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="tabular-nums">{points}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 break-words text-xs text-muted-foreground">
        {reference.sourceName} · generated {reference.generatedAt}
      </p>
      <p className="mt-1 break-all text-xs text-muted-foreground">
        Source SHA-256: {reference.sourceSha256}
      </p>
    </details>
  );
}

/** Source cells stay literal, including absent dates/orders or printed totals
 * that differ from their components. Execution remains the saved Bid policy. */
export function PublishedRankReferences({
  references,
}: { references: readonly MemberRankReference[] | undefined }) {
  if (!references?.length) return null;
  return (
    <section aria-label="Published rank lists" className="border-t border-border pt-3 text-sm">
      <h3 className="mb-1 font-semibold">Published rank lists</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Source reference. Bid eligibility and priority use this bid’s saved evidence.
      </p>
      <div className="divide-y divide-border">
        {references.map((reference) => (
          <details key={reference.listId}>
            <summary className="min-h-11 cursor-pointer content-center font-semibold">
              {reference.title}
              {reference.row.bidOrder === null
                ? ''
                : ` · Published order ${reference.row.bidOrder}`}
            </summary>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 pb-3">
              {reference.columns.map((column) => (
                <div key={column} className="contents">
                  <dt className="break-words">{reference.columnLabels[column]}</dt>
                  <dd className="max-w-40 break-words text-right tabular-nums">
                    {reference.row.values[column] ?? 'Not recorded'}
                  </dd>
                </div>
              ))}
            </dl>
            <details className="pb-3 text-xs text-muted-foreground">
              <summary className="min-h-11 cursor-pointer content-center font-semibold">
                List source
              </summary>
              <div className="space-y-1 break-words">
                <p>{reference.source.name}</p>
                {reference.source.generatedAt.map((date) => (
                  <p key={date}>Generated {date}</p>
                ))}
                <p>
                  Listed as {reference.row.sourceRank} {reference.row.sourceMemberName}
                </p>
                <p>
                  {reference.row.provenance
                    .map((location) => `Page ${location.page}, line ${location.textLine}`)
                    .join(' · ')}
                </p>
                <p className="break-all">Source SHA-256: {reference.source.sha256}</p>
              </div>
            </details>
          </details>
        ))}
      </div>
    </section>
  );
}
