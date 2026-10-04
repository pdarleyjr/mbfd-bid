'use client';

import { Button } from '@/components/ui/button';
import type { DepartmentPersonDetailResponse } from '@mbfd/shared';
import { useEffect, useState } from 'react';
import type { MemberLite } from '../../../_components/bid/types';
import { shortRank } from '../../../_components/bid/types';

export function PreviousBidInfo({
  member,
  compact = false,
}: { member: MemberLite; compact?: boolean }) {
  const previous = member.historicalContext;
  if (compact)
    return (
      <section aria-label="Previous bid and assignment" className="min-w-0 text-xs">
        <h3 className="sr-only font-semibold text-muted-foreground">
          {previous?.year ?? 'Previous'} bid / assignment
        </h3>
        {previous?.evidenceStatus === 'RECORDED' ? (
          <>
            <p className="break-words pr-14 font-medium">
              <span className="text-muted-foreground">{previous.year} · </span>
              {previous.historicalPositionId} · {previous.positionLabel}
            </p>
            <p className="mt-1 break-words">
              {[
                previous.shift ? `${previous.shift} shift` : null,
                previous.station,
                previous.unit,
                `A-Day ${previous.aDayGroup?.replace(/^(?:GR|G)(\d+)$/, 'Group $1') ?? 'not recorded'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {previous?.evidenceStatus === 'NO_PRIOR_BID_OR_ASSIGNMENT'
              ? 'No previous bid or assignment.'
              : previous?.evidenceStatus === 'UNLINKED'
                ? 'Previous bid history has not been linked to this member.'
                : 'Previous bid history is unavailable.'}
          </p>
        )}
      </section>
    );
  return (
    <section
      aria-label="Previous bid and assignment"
      className={compact ? 'min-w-0 text-xs' : 'border-y border-border bg-muted/40 px-3 py-3'}
    >
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {previous?.year ?? 'Previous'} bid / assignment
      </h3>
      {previous?.evidenceStatus === 'RECORDED' ? (
        <>
          <p className={compact ? 'mt-1 break-words font-medium' : 'mt-1 text-sm font-semibold'}>
            {previous.positionLabel}
          </p>
          <p className={compact ? 'mt-1 break-words' : 'mt-1 text-sm'}>
            {[previous.shift ? `${previous.shift} shift` : null, previous.station, previous.unit]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className={compact ? 'mt-1 break-words' : 'mt-1 text-sm'}>
            {previous.historicalPositionId} · A-Day{' '}
            {previous.aDayGroup?.replace(/^(?:GR|G)(\d+)$/, 'Group $1') ?? 'not recorded'}
          </p>
          {!compact ? (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Historical source</summary>
              <p className="mt-1 break-words">
                {previous.sourceName} · {previous.sourceLocation}
              </p>
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {previous?.evidenceStatus === 'NO_PRIOR_BID_OR_ASSIGNMENT'
            ? 'No previous bid or assignment.'
            : previous?.evidenceStatus === 'UNLINKED'
              ? 'Previous bid history has not been linked to this member.'
              : 'Previous bid history is unavailable.'}
        </p>
      )}
    </section>
  );
}

export function BidMemberPanel({
  member,
  upNow,
  compact = false,
  recordedSeats = [],
}: { member: MemberLite; upNow: boolean; compact?: boolean; recordedSeats?: readonly string[] }) {
  const [state, setState] = useState<{
    memberId: number;
    data: DepartmentPersonDetailResponse | null;
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (retry > 0) setState(null);
    let active = true;
    const controller = new AbortController();
    void fetch(`/api/admin/department/people/${member.id}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Member details could not be loaded.');
        return (await response.json()) as DepartmentPersonDetailResponse;
      })
      .then((data) => {
        if (active) setState({ memberId: member.id, data, error: null });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            memberId: member.id,
            data: null,
            error: error instanceof Error ? error.message : 'Member details unavailable.',
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [member.id, retry]);
  const current = state?.memberId === member.id ? state : null;
  if (compact) {
    return (
      <section
        aria-label="Selected member details"
        className="relative min-w-0 shrink-0 border-b border-border bg-card px-3 py-2"
      >
        <div className="grid min-w-0 gap-x-4 gap-y-1 sm:grid-cols-2">
          <header className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
              <p className="text-xs font-semibold text-brand-navy">
                {upNow ? 'Up now' : 'Selected member'}
              </p>
              <h2 className="break-words text-base font-bold">
                {shortRank(member.rank)} {member.firstName} {member.lastName}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Employee {member.employeeId}
              {recordedSeats.length ? ` · Selected ${recordedSeats.join(' / ')}` : ''}
            </p>
            {current?.data?.person.assignments.length ? (
              <p className="mt-1 break-words text-xs">
                <span className="text-muted-foreground">Current: </span>
                {current.data.person.assignments
                  .map((assignment) =>
                    [assignment.positionName, assignment.shift, assignment.unit]
                      .filter(Boolean)
                      .join(' · '),
                  )
                  .join(' / ')}
              </p>
            ) : null}
          </header>
          <PreviousBidInfo member={member} compact />
        </div>
        <details className="absolute right-3 top-1 z-30 text-sm">
          <summary
            aria-label="Member details"
            className="min-h-8 cursor-pointer content-center text-xs font-semibold"
          >
            Details
          </summary>
          <div className="absolute right-0 top-10 max-h-72 w-[min(380px,calc(100vw-4rem))] overflow-y-auto rounded border border-border bg-card p-3 shadow-lg">
            {!current ? (
              <output className="text-muted-foreground">Loading member details…</output>
            ) : current.error ? (
              <div>
                <p role="alert" className="text-warning">
                  {current.error}
                </p>
                <Button
                  type="button"
                  className="mt-2"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry member details
                </Button>
              </div>
            ) : current.data ? (
              <div className="space-y-2 border-t border-border py-2">
                <p className="font-semibold">Current staffing assignment</p>
                {current.data.person.assignments.length ? (
                  current.data.person.assignments.map((assignment) => (
                    <p key={assignment.id}>
                      {[
                        assignment.positionName,
                        assignment.shift,
                        assignment.station,
                        assignment.unit,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground">No current reviewed staffing assignment.</p>
                )}
                <dl className="grid grid-cols-2 gap-2">
                  <dt>Hire date</dt>
                  <dd>{current.data.person.serviceRecord.hiredAt ?? 'Not recorded'}</dd>
                  <dt>Rank seniority</dt>
                  <dd>{current.data.person.serviceRecord.rankSeniority ?? 'Not recorded'}</dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Personnel evidence as of {current.data.asOf}; bid eligibility follows this
                  session’s saved evidence.
                </p>
                <ul className="divide-y divide-border">
                  {current.data.qualifications.certifications.map((credential) => (
                    <li key={credential.credentialId} className="py-1">
                      {credential.credentialName ?? credential.credentialId}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {credential.status}
                      </span>
                    </li>
                  ))}
                </ul>
                {member.historicalContext?.sourceName ? (
                  <p className="break-words text-xs text-muted-foreground">
                    Previous bid source: {member.historicalContext.sourceName} ·{' '}
                    {member.historicalContext.sourceLocation}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      </section>
    );
  }
  return (
    <section aria-label="Selected member details" className="min-w-0 border border-border bg-card">
      <header className="px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-navy">
          {upNow ? 'Up now' : 'Viewing member'}
        </p>
        <h2 className="mt-1 break-words font-heading text-lg font-bold">
          {shortRank(member.rank)} {member.firstName} {member.lastName}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">Employee {member.employeeId}</p>
      </header>
      <PreviousBidInfo member={member} />
      <div className="px-3 py-3">
        {!current ? (
          <output className="text-sm text-muted-foreground">Loading member details…</output>
        ) : current.error ? (
          <>
            <p role="alert" className="text-sm text-warning">
              {current.error}
            </p>
            <Button
              type="button"
              variant="default"
              className="mt-2"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry member details
            </Button>
          </>
        ) : current.data ? (
          <>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Current staffing assignment
            </h3>
            {current.data.person.assignments.length ? (
              current.data.person.assignments.map((assignment) => (
                <p key={assignment.id} className="mt-2 text-sm">
                  {[assignment.positionName, assignment.shift, assignment.station, assignment.unit]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ))
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No current reviewed staffing assignment.
              </p>
            )}
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-semibold">
                Qualifications and service
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Current personnel evidence as of {current.data.asOf}; selection eligibility follows
                this bid’s saved evidence.
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <dt>Hire date</dt>
                <dd>{current.data.person.serviceRecord.hiredAt ?? 'Not recorded'}</dd>
                <dt>Rank seniority</dt>
                <dd>{current.data.person.serviceRecord.rankSeniority ?? 'Not recorded'}</dd>
              </dl>
              <ul className="mt-3 divide-y divide-border text-sm">
                {current.data.qualifications.certifications.map((credential) => (
                  <li key={credential.credentialId} className="py-2">
                    {credential.credentialName ?? credential.credentialId}
                    <span className="ml-2 text-xs text-muted-foreground">{credential.status}</span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </div>
    </section>
  );
}
