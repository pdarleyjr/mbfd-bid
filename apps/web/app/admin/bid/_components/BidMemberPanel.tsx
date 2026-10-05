'use client';

import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import type { DepartmentPersonDetailResponse } from '@mbfd/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { MemberLite } from '../../../_components/bid/types';
import { shortRank } from '../../../_components/bid/types';
import { BidMemberForm, SpecialtyReference, useMemberBidForm } from './BidMemberForm';

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
            <p className="break-words font-medium">
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
  sessionId,
  bidYear,
}: {
  member: MemberLite;
  upNow: boolean;
  compact?: boolean;
  recordedSeats?: readonly string[];
  sessionId?: string | undefined;
  bidYear?: number | null | undefined;
}) {
  const [state, setState] = useState<{
    memberId: number;
    data: DepartmentPersonDetailResponse | null;
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const memberTrigger = useRef<HTMLButtonElement>(null);
  const form = useMemberBidForm({ sessionId, year: bidYear, memberId: member.id, enabled: open });
  useEffect(() => {
    void retry;
    setState(null);
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
  const name = `${shortRank(member.rank)} ${member.firstName} ${member.lastName}`;
  const close = () => {
    setOpen(false);
    memberTrigger.current?.focus();
  };
  const staffing = member.currentAssignment;
  const assignment = staffing
    ? staffing.evidenceStatus === 'RECORDED'
      ? [
          staffing.shift ? (staffing.shift === 'D' ? 'Days' : `${staffing.shift} Shift`) : null,
          staffing.station,
          staffing.unit,
          staffing.positionLabel,
          staffing.aDayGroup
            ? `A-Day ${staffing.aDayGroup.replace(/^G(\d)$/, 'Group $1')}`
            : staffing.shift === 'D'
              ? null
              : 'A-Day not recorded',
        ]
          .filter(Boolean)
          .join(' · ')
      : null
    : current?.data?.person.assignments
        .map((row) =>
          [row.positionName, row.shift, row.station, row.unit].filter(Boolean).join(' · '),
        )
        .join(' / ');
  const personnel = (children: (data: DepartmentPersonDetailResponse) => ReactNode) =>
    !current ? (
      <output className="text-sm text-muted-foreground">Loading member details…</output>
    ) : current.error ? (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-warning">
          {current.error}
        </p>
        <Button type="button" onClick={() => setRetry((value) => value + 1)}>
          Retry member details
        </Button>
      </div>
    ) : current.data ? (
      children(current.data)
    ) : null;
  return (
    <section
      aria-label="Selected member details"
      className={
        compact
          ? 'min-w-0 shrink-0 border-b border-border bg-card px-3 py-2'
          : 'min-w-0 border border-border bg-card p-3'
      }
    >
      <div className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">
        <header className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
            <p className="text-xs font-semibold text-brand-navy">
              {upNow ? 'Up now' : 'Selected member'}
            </p>
            <h2 className={compact ? 'text-base font-bold' : 'font-heading text-lg font-bold'}>
              <button
                ref={memberTrigger}
                type="button"
                aria-haspopup="dialog"
                aria-label={`View ${name} details`}
                className="min-h-8 max-w-full break-words text-left underline decoration-border underline-offset-4 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => {
                  setTab('overview');
                  setRetry((value) => value + 1);
                  setOpen(true);
                }}
              >
                {name}
              </button>
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Employee {member.employeeId}
            {recordedSeats.length ? ` · Selected ${recordedSeats.join(' / ')}` : ''}
          </p>
          {assignment ? (
            <p className="mt-1 break-words text-xs">
              <span className="text-muted-foreground">Current: </span>
              {assignment}
            </p>
          ) : null}
        </header>
        <PreviousBidInfo member={member} compact={compact} />
      </div>
      <TaskPanel
        open={open}
        onClose={close}
        title={name}
        description={`Employee ${member.employeeId} · ${upNow ? 'Up now' : 'Selected member'}${recordedSeats.length ? ` · Selected ${recordedSeats.join(' / ')}` : ''}`}
      >
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList aria-label="Member information" activateOnFocus={false} className="mb-5 w-full">
            <TabsTrigger value="overview" className="min-w-0 flex-1 px-2">
              Overview
            </TabsTrigger>
            <TabsTrigger value="credentials" className="min-w-0 flex-1 px-2">
              Credentials
            </TabsTrigger>
            <TabsTrigger value="form" className="min-w-0 flex-1 px-2">
              Bid form
            </TabsTrigger>
          </TabsList>
          <TabsPrimitive.Panel value="overview" className="space-y-5 outline-none">
            <section className="space-y-2 text-sm">
              <h3 className="font-semibold">Current staffing assignment</h3>
              {assignment ? (
                <p className="break-words">{assignment}</p>
              ) : (
                <p className="text-muted-foreground">Current staffing assignment is unavailable.</p>
              )}
              {staffing?.evidenceStatus === 'RECORDED' && staffing.sourceName ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Current staffing source</summary>
                  <p className="mt-1 break-words">
                    {staffing.sourceName}
                    {staffing.sourceRow ? ` · Row ${staffing.sourceRow}` : ''}
                  </p>
                  {staffing.sourceRank ? (
                    <p>Directory rank / position: {staffing.sourceRank}</p>
                  ) : null}
                </details>
              ) : null}
              {personnel((data) => (
                <>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                    <dt className="text-muted-foreground">Hire date</dt>
                    <dd>{data.person.serviceRecord.hiredAt ?? 'Not recorded'}</dd>
                    <dt className="text-muted-foreground">Rank seniority</dt>
                    <dd>{data.person.serviceRecord.rankSeniority ?? 'Not recorded'}</dd>
                  </dl>
                </>
              ))}
            </section>
            <PreviousBidInfo member={member} />
          </TabsPrimitive.Panel>
          <TabsPrimitive.Panel value="credentials" className="space-y-5 outline-none">
            {personnel((data) => (
              <>
                <div>
                  <h3 className="text-sm font-semibold">Current certifications</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Personnel evidence as of {data.asOf}. Bid eligibility uses this session’s saved
                    evidence.
                  </p>
                </div>
                {data.qualifications.certifications.length ? (
                  <ul className="divide-y divide-border text-sm">
                    {data.qualifications.certifications.map((credential) => (
                      <li
                        key={credential.credentialId}
                        className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"
                      >
                        <span className="min-w-0 break-words font-medium">
                          {credential.credentialName ?? `Credential ${credential.credentialId}`}
                        </span>
                        <span
                          className={
                            credential.status === 'active' ? 'text-success' : 'text-warning'
                          }
                        >
                          {credential.status}
                        </span>
                        {credential.effectiveOn || credential.expiresOn ? (
                          <p className="w-full text-xs text-muted-foreground">
                            {[
                              credential.effectiveOn ? `Effective ${credential.effectiveOn}` : null,
                              credential.expiresOn ? `Expires ${credential.expiresOn}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No current certifications recorded.
                  </p>
                )}
                {data.qualifications.specialties?.length ? (
                  <section>
                    <h3 className="text-sm font-semibold">Specialty qualifications</h3>
                    <ul className="mt-2 divide-y divide-border text-sm">
                      {data.qualifications.specialties.map((specialty) => (
                        <li
                          key={`${specialty.specialtyCode}-${specialty.eventId}`}
                          className="flex justify-between gap-4 py-2"
                        >
                          <span className="break-words">{specialty.specialtyCode}</span>
                          <span className="text-muted-foreground">{specialty.status}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ))}
            <SpecialtyReference
              reference={form.current?.data?.airTechReference}
              rankReferences={form.current?.data?.rankReferences}
            />
          </TabsPrimitive.Panel>
          <TabsPrimitive.Panel value="form" className="outline-none">
            <BidMemberForm
              current={form.current}
              retry={form.retry}
              hasSession={Boolean(sessionId && bidYear)}
            />
          </TabsPrimitive.Panel>
        </Tabs>
      </TaskPanel>
    </section>
  );
}
