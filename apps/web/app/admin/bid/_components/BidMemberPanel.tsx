'use client';

import { Button } from '@/components/ui/button';
import type { DepartmentPersonDetailResponse } from '@mbfd/shared';
import { useEffect, useState } from 'react';
import type { MemberLite } from '../../../_components/bid/types';
import { shortRank } from '../../../_components/bid/types';

export function PreviousBidInfo({ member }: { member: MemberLite }) {
  const previous = member.historicalContext;
  return (
    <section
      aria-label="Previous bid and assignment"
      className="border-y border-border bg-muted/40 px-3 py-3"
    >
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {previous?.year ?? 'Previous'} bid / assignment
      </h3>
      {previous?.evidenceStatus === 'RECORDED' ? (
        <>
          <p className="mt-1 text-sm font-semibold">{previous.positionLabel}</p>
          <p className="mt-1 text-sm">
            {[previous.shift ? `${previous.shift} shift` : null, previous.station, previous.unit]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-1 text-sm">
            {previous.historicalPositionId} · A-Day{' '}
            {previous.aDayGroup?.replace(/^(?:GR|G)(\d+)$/, 'Group $1') ?? 'not recorded'}
          </p>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Historical source</summary>
            <p className="mt-1 break-words">
              {previous.sourceName} · {previous.sourceLocation}
            </p>
          </details>
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

export function BidMemberPanel({ member, upNow }: { member: MemberLite; upNow: boolean }) {
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
