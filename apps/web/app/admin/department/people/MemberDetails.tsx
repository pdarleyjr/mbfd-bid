'use client';

import { Button } from '@/components/ui/button';
import type { DepartmentPersonDetailResponse } from '@mbfd/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

function words(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium tabular-nums">
        {value ?? 'Not recorded'}
      </dd>
    </div>
  );
}

export function MemberDetails({
  data,
  onUpdate,
}: { data: DepartmentPersonDetailResponse; onUpdate: () => void }) {
  const { person, qualifications, history } = data;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      aria-label="Member details"
      className="min-w-0 space-y-6 rounded-xl border border-border bg-card p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Member information as of {data.asOf}</p>
          <h2
            ref={heading}
            tabIndex={-1}
            className="mt-1 break-words font-heading text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {person.firstName} {person.lastName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {person.employeeId} · {person.rank ?? 'Civilian'} ·{' '}
            {person.employmentStatus === 'unknown'
              ? 'Needs classification'
              : words(person.employmentStatus)}
          </p>
        </div>
        <Button onClick={onUpdate}>Update member</Button>
      </header>
      <section aria-labelledby="member-assignment-heading">
        <h3 id="member-assignment-heading" className="font-semibold">
          Current assignment
        </h3>
        {person.assignments.length ? (
          <ul className="mt-3 space-y-3">
            {person.assignments.map((position) => (
              <li key={position.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="break-words font-semibold">
                  {position.positionName ?? position.stableSlotKey}
                </p>
                <p className="mt-1 break-words">
                  {[
                    position.shift ? `${position.shift} shift` : null,
                    position.station ?? position.division,
                    position.unit,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Effective {position.assignment?.effectiveFrom ?? 'date not recorded'}
                  {position.assignment?.effectiveTo
                    ? ` through ${position.assignment.effectiveTo}`
                    : ' onward'}
                </p>
                {position.temporaryContext.map((context) => (
                  <p key={context.id} className="mt-2 text-xs text-info">
                    {words(context.kind)} from {context.effectiveOn}
                    {context.plannedEndOn ? `; planned end ${context.plannedEndOn}` : ''}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {person.hasAssignment
              ? 'An assignment exists outside the reviewed positions available for this date.'
              : 'No staffing assignment on this date.'}
          </p>
        )}
      </section>
      <section aria-labelledby="member-service-heading">
        <h3 id="member-service-heading" className="font-semibold">
          Service and seniority
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Service dates and seniority reflect the latest recorded information.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <Field label="RSC seniority" value={person.serviceRecord.rscSeniority} />
          <Field label="Rank seniority" value={person.serviceRecord.rankSeniority} />
          <Field label="Hire date" value={person.serviceRecord.hiredAt} />
          <Field label="Promotion date" value={person.serviceRecord.promotedAt} />
          <Field label="Status effective date" value={person.employmentStatusEffectiveOn} />
          {person.separationType && <Field label="Separation type" value={person.separationType} />}
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-4 text-sm">
          <Link
            className="inline-flex min-h-11 items-center font-medium underline"
            href={`/admin/personnel/service-evidence?memberId=${person.id}` as Route}
          >
            Service evidence
          </Link>
          <Link
            className="inline-flex min-h-11 items-center font-medium underline"
            href={`/admin/personnel/bid-evidence?memberId=${person.id}` as Route}
          >
            Bid ordinals and tour evidence
          </Link>
          <Link
            className="inline-flex min-h-11 items-center font-medium underline"
            href={'/admin/personnel/tenure' as Route}
          >
            Review protected positions
          </Link>
        </div>
      </section>
      <section aria-labelledby="member-credentials-heading">
        <h3 id="member-credentials-heading" className="font-semibold">
          Credentials and qualifications
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Recorded evidence and status on the selected date.
        </p>
        {qualifications.certifications.length + qualifications.specialties.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No qualification evidence is recorded for this date.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {qualifications.certifications.map((credential) => (
              <li key={credential.credentialId} className="py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="break-words font-medium">
                    {credential.credentialName ?? `Credential ${credential.credentialId}`}
                  </p>
                  <span
                    className={credential.status === 'active' ? 'text-success' : 'text-warning'}
                  >
                    {words(credential.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {credential.effectiveOn
                    ? `Effective ${credential.effectiveOn}`
                    : 'Effective date not recorded'}
                  {credential.expiresOn
                    ? ` · Expires ${credential.expiresOn}`
                    : ' · Expiration not recorded'}
                </p>
                {(credential.evidenceSource || credential.evidenceReference) && (
                  <p className="mt-1 break-words text-xs">
                    {[credential.evidenceSource, credential.evidenceReference]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
            {qualifications.specialties.map((specialty) => (
              <li key={specialty.specialtyCode} className="py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="break-words font-medium">{specialty.specialtyCode}</p>
                  <span className={specialty.status === 'active' ? 'text-success' : 'text-warning'}>
                    {words(specialty.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Effective {specialty.effectiveOn}
                  {specialty.expiresOn ? ` · Expires ${specialty.expiresOn}` : ''}
                </p>
                <p className="mt-1 break-words text-xs">
                  {specialty.evidenceSource}
                  {specialty.evidenceReference ? ` · ${specialty.evidenceReference}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="member-history-heading">
        <h3 id="member-history-heading" className="font-semibold">
          Effective-dated history
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Includes recorded future changes. Expand an event to inspect its reason and source.
        </p>
        <div className="mt-3 space-y-3">
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-8 cursor-pointer text-sm font-medium">
              Employment and rank ({history.personnelEvents.length})
            </summary>
            <ol className="mt-2 space-y-3">
              {history.personnelEvents.map((event) => (
                <li key={event.id} className="border-t border-border pt-3 text-sm">
                  <p className="font-medium">
                    {event.effectiveOn} · {words(event.kind)}
                  </p>
                  <p className="mt-1 break-words">{event.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.rankBefore ?? 'No rank'} → {event.rankAfter ?? 'No rank'} ·{' '}
                    {event.employmentStatusBefore ?? 'Not recorded'} →{' '}
                    {event.employmentStatusAfter ?? 'Not recorded'}
                  </p>
                  <p className="mt-1 break-words text-xs">
                    Source: {event.origin} · Recorded by {event.actorSubject}
                  </p>
                </li>
              ))}
            </ol>
          </details>
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-8 cursor-pointer text-sm font-medium">
              Assignments ({history.assignments.length})
            </summary>
            <ol className="mt-2 space-y-3">
              {history.assignments.map((assignment) => (
                <li key={assignment.id} className="border-t border-border pt-3 text-sm">
                  <p className="font-medium">
                    {assignment.effectiveFrom}
                    {assignment.effectiveTo ? ` through ${assignment.effectiveTo}` : ' onward'} ·{' '}
                    {words(assignment.status)}
                  </p>
                  <p className="mt-1 break-all text-xs">
                    Position reference: {assignment.staffingPositionId}
                  </p>
                  <p className="mt-1 break-words text-xs">
                    {words(assignment.originType)} · {assignment.originRef}
                  </p>
                </li>
              ))}
            </ol>
          </details>
          <details className="rounded-lg border border-border p-3">
            <summary className="min-h-8 cursor-pointer text-sm font-medium">
              Qualification evidence ({history.qualificationEvents.length})
            </summary>
            <ol className="mt-2 space-y-3">
              {history.qualificationEvents.map((event) => (
                <li key={event.id} className="border-t border-border pt-3 text-sm">
                  <p className="font-medium">
                    {event.effectiveOn} · {words(event.kind)}
                  </p>
                  <p className="mt-1 break-words">
                    {event.credentialName ??
                      event.specialtyCode ??
                      `Credential ${event.credentialId}`}{' '}
                    · {event.reason}
                  </p>
                  <p className="mt-1 break-words text-xs">
                    {event.evidenceSource}
                    {event.evidenceReference ? ` · ${event.evidenceReference}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        </div>
      </section>
    </section>
  );
}
