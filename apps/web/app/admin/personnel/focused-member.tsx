'use client';
import type { DepartmentRosterProjection } from '@mbfd/shared';
import { useEffect, useRef, useState } from 'react';

export interface MemberInteractionState {
  dirty: boolean;
  busy: boolean;
  uncertain: boolean;
}

export interface FocusedMemberCallbacks {
  focusedMember?: boolean;
  onInteractionState?: (state: MemberInteractionState) => void;
  onAccepted?: () => void;
}

export function useMemberInteractionState(
  focused: boolean,
  { dirty, busy, uncertain }: MemberInteractionState,
  onChange: FocusedMemberCallbacks['onInteractionState'],
) {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (focused) callback.current?.({ dirty, busy, uncertain });
  }, [focused, dirty, busy, uncertain]);
}

export function useStaffingTargets(asOf: string, enabled: boolean) {
  const [projection, setProjection] = useState<DepartmentRosterProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision explicitly reloads the same dated projection.
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setProjection(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/department/current-roster?as_of=${encodeURIComponent(asOf)}`,
          { credentials: 'include', signal: controller.signal },
        );
        const body = (await response.json()) as DepartmentRosterProjection;
        if (!response.ok || body.asOf !== asOf || !Array.isArray(body.positions))
          throw new Error('Staffing positions could not be loaded for this effective date.');
        if (!controller.signal.aborted) setProjection(body);
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : 'Staffing positions could not be loaded.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [asOf, enabled, revision]);
  return {
    projection: projection?.asOf === asOf ? projection : null,
    error,
    loading,
    retry: () => setRevision((value) => value + 1),
  };
}

export function readableEvidence(value: unknown): string {
  if (value === null || value === undefined) return 'Not provided';
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value);
}

export function EvidenceValues({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return value.length === 0 ? (
      <p>None returned</p>
    ) : (
      <ul className="space-y-2">
        {value.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: The immutable preview is replaced as a whole and contains no interactive child state.
          <li key={index}>
            <EvidenceValues value={item} />
          </li>
        ))}
      </ul>
    );
  if (value !== null && typeof value === 'object')
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key} className="min-w-0">
            <dt className="font-medium">
              {key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}
            </dt>
            <dd className="pl-3 [overflow-wrap:anywhere]">
              <EvidenceValues value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{readableEvidence(value)}</span>;
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function matchesPersonnelPreview(value: unknown, request: Record<string, unknown>) {
  const preview = evidenceRecord(value);
  const current = evidenceRecord(preview.current);
  const member = evidenceRecord(current.member);
  const plan = evidenceRecord(preview.proposed);
  const event = evidenceRecord(plan.event);
  const afterState = evidenceRecord(event.afterState);
  return (
    preview.preview === true &&
    plan.ok === true &&
    member.id === request.member_id &&
    event.kind === request.kind &&
    event.effectiveOn === request.effective_on &&
    afterState.staffingPositionId === (request.staffing_position_id ?? null) &&
    Array.isArray(current.assignments) &&
    Array.isArray(plan.assignmentClosures) &&
    (plan.assignmentCreation === null ||
      Object.keys(evidenceRecord(plan.assignmentCreation)).length > 0) &&
    typeof preview.vacancyImpact === 'string' &&
    typeof preview.qualificationImpact === 'string'
  );
}

function humanValue(value: unknown) {
  if (value === null || value === undefined) return 'Not provided';
  if (typeof value !== 'string') return readableEvidence(value);
  if (value === 'CIVILIAN') return 'Civilian';
  return value.replaceAll('_', ' ');
}

export function EnteredMemberDetails({ value }: { value: unknown }) {
  const change = evidenceRecord(value);
  const member = evidenceRecord(change.new_member);
  return (
    <EvidenceValues
      value={{
        'Employee identifier': member.employee_id,
        'First name': member.first_name,
        'Last name': member.last_name,
        Rank: member.rank === null ? 'Civilian' : member.rank,
        'Employment begins': change.effective_on,
        'Hire date': member.hired_at,
        'RSC seniority': member.rsc_seniority,
        'Bid participation category': member.bid_category,
        Reason: change.reason,
      }}
    />
  );
}

/** Present the server plan; never derive lifecycle or eligibility decisions here. */
export function PersonnelPreview({
  preview,
  positions = [],
}: {
  preview: Record<string, unknown>;
  positions?: DepartmentRosterProjection['positions'];
}) {
  const current = evidenceRecord(preview.current);
  const member = evidenceRecord(current.member);
  const plan = evidenceRecord(preview.proposed);
  const event = evidenceRecord(plan.event);
  const beforeState = evidenceRecord(event.beforeState);
  const afterState = evidenceRecord(event.afterState);
  const beforeAssignment = evidenceRecord(beforeState.assignment);
  const afterAssignment = evidenceRecord(afterState.assignment);
  const recorded = Array.isArray(current.assignments)
    ? current.assignments.map(evidenceRecord)
    : [];
  const closures = Array.isArray(plan.assignmentClosures)
    ? plan.assignmentClosures.map(evidenceRecord)
    : [];
  const creation =
    plan.assignmentCreation === null ? null : evidenceRecord(plan.assignmentCreation);
  function positionName(id: unknown) {
    const position = positions.find((item) => item.id === id);
    return position
      ? [
          position.shift ? `${position.shift} shift` : null,
          position.station ?? position.division,
          position.unit,
          position.positionName,
        ]
          .filter(Boolean)
          .join(' · ') || position.stableSlotKey
      : typeof id === 'string'
        ? `Position reference: ${id}`
        : 'Position not provided';
  }
  const vacancyLabels: Record<string, string> = {
    KNOWN_VACANT: 'Vacant on the effective date',
    KNOWN_OCCUPIED: 'Occupied on the effective date',
    CURRENT_MEMBER_OCCUPIES_TARGET: 'The selected member occupies this position',
    NOT_DETERMINED_BY_PERSONNEL_PREVIEW: 'Unknown',
  };
  return (
    <section
      aria-label="Personnel change preview"
      className="mt-3 space-y-3 rounded border border-border p-3 text-sm"
    >
      <h3 className="font-semibold">Review personnel change</h3>
      <p>
        {humanValue(event.kind)} · Effective {humanValue(event.effectiveOn)}
      </p>
      <p className="[overflow-wrap:anywhere]">{humanValue(event.reason)}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h4 className="mb-2 font-semibold">Current</h4>
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">Employment status</dt>
              <dd>{humanValue(member.employmentStatus)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rank</dt>
              <dd>{humanValue(member.rank)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Assignment</dt>
              <dd className="[overflow-wrap:anywhere]">
                {beforeState.assignment === null
                  ? 'No assignment on this date'
                  : positionName(beforeAssignment.staffingPositionId)}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h4 className="mb-2 font-semibold">Proposed</h4>
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">Employment status</dt>
              <dd>{humanValue(event.employmentStatusAfter)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rank</dt>
              <dd>{event.rankAfter === null ? 'No sworn rank' : humanValue(event.rankAfter)}</dd>
            </div>
            {typeof event.separationType === 'string' && event.separationType && (
              <div>
                <dt className="text-muted-foreground">Separation type</dt>
                <dd>{humanValue(event.separationType)}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Assignment</dt>
              <dd className="[overflow-wrap:anywhere]">
                {afterState.assignment === null
                  ? 'No assignment after this change'
                  : positionName(afterAssignment.staffingPositionId)}
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <section aria-label="Proposed assignment changes" className="space-y-2">
        <h4 className="font-semibold">Assignment changes</h4>
        {Array.isArray(plan.assignmentClosures) &&
          plan.assignmentCreation === null &&
          closures.length === 0 && <p>No assignment changes are proposed.</p>}
        <ul className="space-y-2 [overflow-wrap:anywhere]">
          {closures.map((closure) => {
            const assignment = recorded.find((item) => item.id === closure.id);
            return (
              <li key={String(closure.id)}>
                End {positionName(assignment?.staffingPositionId)} after{' '}
                {humanValue(closure.effectiveTo)}.
              </li>
            );
          })}
          {creation && Object.keys(creation).length > 0 && (
            <li>
              Assign {positionName(creation.staffingPositionId)} from{' '}
              {humanValue(creation.effectiveFrom)} · {humanValue(creation.status)}.
            </li>
          )}
        </ul>
      </section>
      {recorded.length > 0 && (
        <details>
          <summary className="min-h-8 cursor-pointer">
            Recorded assignment history ({recorded.length})
          </summary>
          <ul className="mt-2 space-y-2 [overflow-wrap:anywhere]">
            {recorded.map((assignment) => (
              <li key={String(assignment.id)}>
                {positionName(assignment.staffingPositionId)} · {humanValue(assignment.status)} ·{' '}
                {humanValue(assignment.effectiveFrom)} through{' '}
                {assignment.effectiveTo === null
                  ? 'an open end'
                  : humanValue(assignment.effectiveTo)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>
        <strong>Vacancy impact:</strong>{' '}
        {vacancyLabels[String(preview.vacancyImpact)] ?? readableEvidence(preview.vacancyImpact)}
      </p>
      <p>
        <strong>Qualification impact:</strong>{' '}
        {preview.qualificationImpact === 'NOT_DETERMINED_BY_PERSONNEL_PREVIEW'
          ? 'Unknown — this preview does not evaluate qualifications.'
          : readableEvidence(preview.qualificationImpact)}
      </p>
    </section>
  );
}
