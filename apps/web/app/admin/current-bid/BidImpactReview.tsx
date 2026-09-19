'use client';
import { BidTermIssues } from './BidTermIssues';

import { Button } from '@/components/ui/button';
import {
  type BidDefinitionContent,
  type BidImpactResponse,
  BidImpactResponseSchema,
} from '@mbfd/shared';
import { useEffect, useRef, useState } from 'react';
import { ChoiceField, FieldSection, ReferencePicker, TextField } from './BidFields';
import { type BidExpected, BidRequestError, bidRequest } from './bid-client';

type Result = Extract<BidImpactResponse, { valid: true }>;
type Trace = NonNullable<Result['trace']>['after'];
const words = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const labels: Record<string, string> = {
  bid_configuration_unconfigured: 'Configure the Bid timing and evidence dates first.',
  bid_configuration_credential_evaluation_date_required: 'Choose a qualification evaluation date.',
  bid_configuration_live_policy_required:
    'Configure the operating policy to evaluate Live participation.',
  policy_source_decision_required: 'Resolve the open policy source decisions.',
  credential_import_dispute_requires_review:
    'Review the disputed qualification imports used by this policy.',
  tenure_evidence_requires_review: 'Review tenure evidence for the affected staffing positions.',
  stage_member_population_mismatch:
    'The stage participants do not cover the evaluated Bid population.',
  stage_member_reference_invalid: 'A stage contains a member outside the evaluated Bid population.',
  stage_rank_category_mismatch: 'A stage contains a member or opportunity with a different rank.',
  action_actor_reference_invalid:
    'An action permission names a person absent from the Department evidence.',
  stage_seniority_tie: 'Two members have the same stage seniority. Review the ordering evidence.',
  stage_ordering_fact_missing:
    'A frozen stage ordering fact is missing. Review the resolved participant evidence.',
  stage_ordering_tie:
    'The configured stage ordering still ties. Review the resolved participant evidence.',
  rule_book_invalid:
    'An opportunity is missing valid requirements. Review the configuration comparison.',
  bid_impact_context_changed:
    'Department evidence changed since this comparison. Evaluate the draft again.',
  bid_definition_or_source_changed:
    'The saved Bid or Department evidence changed. Refresh and review your edits.',
};
const explain = (code: string) => labels[code] ?? words(code);

function TraceCard({ title, trace }: { title: string; trace: Trace }) {
  return (
    <FieldSection title={title}>
      {trace.status !== 'EVALUATED' ? (
        <p>{explain(trace.code)}</p>
      ) : (
        <>
          <p className="font-medium">
            {trace.eligible
              ? 'Meets the opportunity requirements'
              : 'Does not meet the opportunity requirements'}
          </p>
          <p className="text-sm">
            {trace.points} points · {trace.soPoints} Special Operations · {trace.moPoints} Marine
            Operations
            {trace.priority !== null ? ` · Priority ${trace.priority}` : ''}
          </p>
          {trace.pool.mockParticipationEvidence && (
            <p className="text-sm">
              Mock participation uses the accepted staffing baseline because employment is
              unconfirmed. Live participation is evaluated separately.
            </p>
          )}
          <ul className="space-y-2 text-sm">
            {trace.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>
                <strong>{reason.satisfied ? 'Pass' : 'Fail'}:</strong> {reason.label}
              </li>
            ))}
          </ul>
          {trace.stage && (
            <p className="text-sm">
              Stage {trace.stage.id}:{' '}
              {trace.stage.opportunityAllowed
                ? 'this opportunity is available in the stage.'
                : 'this opportunity is outside the stage.'}
            </p>
          )}
          <details>
            <summary className="mb-2 min-h-11 content-center cursor-pointer">Point awards</summary>
            <p className="mb-2 text-xs text-muted-foreground">
              The server calculates all three channels from the evaluated qualifications. Legacy
              total-channel item awards are shown before the overall cap; configured groups include
              their caps.
            </p>
            {(['total', 'so', 'mo'] as const).map((channel) => (
              <div key={channel} className="mt-3">
                <p className="text-sm font-medium">
                  {{ total: 'Total', so: 'Special Operations', mo: 'Marine Operations' }[channel]}:{' '}
                  {trace.channels[channel].total}
                </p>
                {trace.channels[channel].itemized.length ? (
                  <ul className="space-y-2 text-sm">
                    {trace.channels[channel].itemized.map((item, index) => (
                      <li key={`${item.credential}-${index}`}>
                        {item.credential}: <strong>{item.awarded}</strong>
                        {item.reason ? ` — ${item.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm">No item awards in this channel.</p>
                )}
              </div>
            ))}
          </details>
          <details>
            <summary className="mb-2 min-h-11 content-center cursor-pointer">
              Priority and tie break
            </summary>
            <p className="text-sm">
              Configured order:{' '}
              {trace.tieBreakChain.map(words).join(' → ') || 'No tie break configured'}.
            </p>
            {trace.comparison ? (
              <>
                <ol className="mt-2 space-y-1 text-sm">
                  {trace.comparison.steps.map((step, index) => (
                    <li key={`${step.key}-${index}`}>
                      {step.criterion ?? words(step.key)}: {step.left} versus {step.right};{' '}
                      {words(step.direction)}. {step.sourceRef ? `Source: ${step.sourceRef}. ` : ''}
                      {step.result === 0
                        ? 'Equal; continue.'
                        : step.result < 0
                          ? 'Selected member ranks first.'
                          : 'Comparison member ranks first.'}
                    </li>
                  ))}
                </ol>
                {trace.comparison.result === 0 && (
                  <p className="text-sm font-medium">
                    The entire configured chain ties. No additional tie break was invented.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm">
                {trace.comparisonUnavailableReason
                  ? explain(trace.comparisonUnavailableReason)
                  : 'Choose another member to inspect a comparison.'}
              </p>
            )}
          </details>
          <details>
            <summary className="mb-2 min-h-11 content-center cursor-pointer">Evidence used</summary>
            <p className="text-sm">
              Rank: {trace.evidence.rank}. Probationary:{' '}
              {trace.evidence.isProbationary ? 'Yes' : 'No'}.
            </p>
            <p className="break-words text-sm">
              Active qualifications:{' '}
              {trace.evidence.credentialNames.join(', ') || 'None in the evaluated evidence'}.
            </p>
            {trace.evidence.serviceCredits.map((credit) => (
              <p key={credit.recordId} className="break-words text-sm">
                {credit.serviceCode}: {credit.verifiedMonths ?? 'Unconfirmed'} months ·{' '}
                {credit.sourceRef}
              </p>
            ))}
          </details>
          {trace.postAward.length > 0 && (
            <details>
              <summary className="mb-2 min-h-11 content-center cursor-pointer">
                Post-award obligations
              </summary>
              <p className="text-sm">
                These follow-up obligations do not determine initial eligibility.
              </p>
              <ul className="space-y-2 text-sm">
                {trace.postAward.map((term) => (
                  <li key={term.id}>
                    {term.credential}: {term.deadline.count} {words(term.deadline.unit)} from{' '}
                    {words(term.deadline.basis)} · {term.sourceRef}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </FieldSection>
  );
}

function SideStatus({ label, side }: { label: string; side: Result['before'] }) {
  return (
    <FieldSection title={label}>
      {side.status === 'BLOCKED' ? (
        <>
          <p>{explain(side.code)}</p>
          {!!side.positionIds.length && (
            <p className="break-words text-sm">
              Affected opportunities: {side.positionIds.join(', ')}
            </p>
          )}
          {side.tenureIssues.map((issue) => (
            <p className="text-sm" key={`${issue.recordId}-${issue.code}`}>
              {issue.staffingPositionId}: {explain(issue.code)}
            </p>
          ))}
          <BidTermIssues issues={side.termIssues} />
        </>
      ) : (
        <>
          <p className="text-sm">
            Personnel: {side.personnelEvaluationOn} · Qualifications: {side.credentialEvaluationOn}
          </p>
          <p>
            {side.members.filter((member) => member.pool !== 'EXCLUDED').length} participants ·{' '}
            {side.members.filter((member) => member.pool === 'EXCLUDED').length} excluded
          </p>
          <p className="text-sm">{side.opportunities.length} opportunities evaluated.</p>
          {!!side.executionReferenceErrors.length && (
            <div>
              <p className="font-medium">Operating policy references need review:</p>
              <ul className="space-y-1 text-sm">
                {side.executionReferenceErrors.map((code) => (
                  <li key={code}>{explain(code)}</li>
                ))}
              </ul>
            </div>
          )}
          {side.stageOrder.status === 'EVALUATED' ? (
            <p className="text-sm">
              Stage order evaluated for {side.stageOrder.entries.length} participants.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {side.stageOrder.codes.map((code) => (
                <li key={code}>{explain(code)}</li>
              ))}
            </ul>
          )}
          {side.specialties.map((specialty) => (
            <p key={specialty.id} className="text-sm">
              {specialty.id}:{' '}
              {specialty.status === 'EVALUATED'
                ? `${specialty.candidates.length} ranked candidates`
                : explain(specialty.code ?? 'specialty_evaluation_invalid')}
            </p>
          ))}
        </>
      )}
    </FieldSection>
  );
}

/** The browser only displays server calculations. Every drill-down is bound to
 * the reviewed impact hash; local edits make previous results unavailable. */
export function BidImpactReview({
  content,
  expected,
  year,
  locked,
  begin,
  finish,
  onImpact,
}: {
  content: BidDefinitionContent;
  expected: BidExpected;
  year: number;
  locked: boolean;
  begin: () => boolean;
  finish: () => void;
  /** Lets the visual-only Blueprint consume the exact server result. */
  onImpact?: (result: BidImpactResponse | null) => void;
}) {
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [result, setResult] = useState<BidImpactResponse | null>(null);
  const [resultStamp, setResultStamp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState('');
  const [position, setPosition] = useState('');
  const [otherMember, setOtherMember] = useState('');
  const [query, setQuery] = useState('');
  const [opportunityPage, setOpportunityPage] = useState(0);
  const requestSequence = useRef(0);
  const traceHeading = useRef<HTMLHeadingElement>(null);
  const focusTrace = useRef(false);
  const stamp = JSON.stringify({ content, expected, mode });
  const current = resultStamp === stamp && result?.valid ? result : null;
  const comparison = current?.comparison.status === 'EVALUATED' ? current.comparison : null;
  useEffect(() => {
    onImpact?.(current);
  }, [current, onImpact]);
  useEffect(() => {
    if (!current?.trace || !focusTrace.current || !traceHeading.current) return;
    focusTrace.current = false;
    traceHeading.current.focus({ preventScroll: true });
    traceHeading.current.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }, [current?.trace]);
  const members = [
    ...new Map(
      [
        ...(current?.before.status === 'EVALUATED' ? current.before.members : []),
        ...(current?.after.status === 'EVALUATED' ? current.after.members : []),
      ].map((row) => [row.memberId, row]),
    ).values(),
  ];
  const names = new Map(
    members.map((row) => [row.memberId, row.displayName ?? `Member ${row.memberId}`]),
  );
  const beforeCounts = new Map(
    current?.before.status === 'EVALUATED'
      ? current.before.opportunities.map((row) => [row.positionId, row])
      : [],
  );
  const afterCounts = new Map(
    current?.after.status === 'EVALUATED'
      ? current.after.opportunities.map((row) => [row.positionId, row])
      : [],
  );
  const opportunities = [...new Set([...beforeCounts.keys(), ...afterCounts.keys()])].filter((id) =>
    `${id} ${content.positions.find((row) => row.id === id)?.positionName ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const visibleOpportunityPage = Math.min(
    opportunityPage,
    Math.max(0, Math.ceil(opportunities.length / 20) - 1),
  );

  async function evaluate(
    offset = 0,
    selection?: { memberId: number; positionId: string; compareMemberId?: number },
    followUp = false,
  ) {
    if (!begin()) return;
    setError(null);
    const sequence = ++requestSequence.current;
    const capturedStamp = stamp;
    try {
      const next = await bidRequest(year, 'preview', BidImpactResponseSchema, {
        body: {
          kind: 'impact',
          expected,
          intent: { operation: 'save', content },
          mode,
          changeOffset: offset,
          ...((followUp || offset > 0 || selection) && current?.impactSha256
            ? { expectedImpactSha256: current.impactSha256 }
            : {}),
          ...(selection ? { trace: selection } : {}),
        },
      });
      if (sequence !== requestSequence.current) return;
      focusTrace.current = !!selection && next.valid && !!next.trace;
      setResult(next);
      setResultStamp(capturedStamp);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setResult(null);
      setError(
        caught instanceof BidRequestError
          ? explain(caught.code)
          : caught instanceof Error
            ? caught.message
            : 'The draft could not be evaluated.',
      );
    } finally {
      finish();
    }
  }

  const livePolicy = content.settings?.v === 3 ? content.settings.livePolicy : null;
  return (
    <div className="space-y-4">
      <FieldSection
        title="How this Bid flows"
        description="This map shows the authored draft. Evaluate it below to check the Department population, requirements and ordering."
      >
        {livePolicy?.stages.length ? (
          <ol className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...livePolicy.stages]
              .sort((a, b) => a.order - b.order)
              .map((stage, index) => (
                <li key={stage.id} className="min-w-0 rounded border border-border p-3">
                  <p className="break-words font-medium">
                    {index + 1}. {stage.label || stage.id}
                  </p>
                  <p className="text-sm">
                    {stage.memberIds.length} selected people · {stage.opportunityPositionIds.length}{' '}
                    opportunities
                  </p>
                  <p className="text-xs text-muted-foreground">{words(stage.kind)}</p>
                </li>
              ))}
          </ol>
        ) : (
          <p>No operating stages configured.</p>
        )}
      </FieldSection>
      <FieldSection
        title="Draft impact"
        description="Evaluate the saved Bid and your unsaved draft against the same captured Department evidence. No version or run is created."
      >
        <ChoiceField
          label="Participation for this calculation"
          value={mode}
          options={[
            { value: 'mock', label: 'Mock participation' },
            { value: 'live', label: 'Live participation' },
          ]}
          onChange={(value) => {
            setMode(value);
            setError(null);
          }}
        />
        <Button type="button" variant="primary" disabled={locked} onClick={() => void evaluate()}>
          Evaluate draft impact
        </Button>
        {error && <p role="alert">{error}</p>}
        {result && resultStamp !== stamp && (
          <p>The draft has changed. Evaluate it again for current results.</p>
        )}
        {resultStamp === stamp && result?.valid === false && (
          <ul className="space-y-2 text-sm">
            {result.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                {issue.path.join(' › ')}: {issue.message}
              </li>
            ))}
          </ul>
        )}
        {current && (
          <>
            <p className="text-xs text-muted-foreground">
              Captured {new Date(current.capturedAtMs).toLocaleString()}. This calculation does not
              approve publication or starting a Live Bid.
            </p>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              <SideStatus label="Current saved Bid" side={current.before} />
              <SideStatus label="Unsaved draft" side={current.after} />
            </div>
            <p className="text-sm">
              A-Day capacity, next-bidder decisions, interruptions and awards require an explicit
              selection scenario. These outcomes have not been predicted by this comparison.
            </p>
            {comparison ? (
              <>
                <output data-testid="bid-impact-change-summary" className="block font-medium">
                  {comparison.affectedMemberIds.length} people with evaluated changes.
                </output>
                <p className="text-sm">
                  {comparison.eligibility.policyChangeCount} opportunity/member changes from policy
                  · {comparison.eligibility.evidenceChangeCount} from evidence dates or
                  participation.
                </p>
                <p className="text-sm">
                  {comparison.poolChanges.length} participation changes ·{' '}
                  {comparison.stageChanges?.length ?? 'Unavailable'} stage-order changes ·{' '}
                  {comparison.stageOpportunityChanges?.length ?? 'Unavailable'} stage opportunity
                  changes.
                </p>
                {!!comparison.unavailableAreas.length && (
                  <p className="text-sm">
                    The affected-person count excludes results that could not be evaluated:{' '}
                    {comparison.unavailableAreas.map(words).join(', ')}.
                  </p>
                )}
                {comparison.specialtyChanges.some((row) => row.changes.length > 0) && (
                  <ul className="space-y-2 text-sm">
                    {comparison.specialtyChanges
                      .filter((row) => row.changes.length > 0)
                      .map((row) => (
                        <li key={row.id}>
                          {row.id}: {row.changes.length} candidates with ranking, applicability or
                          behavior changes.
                          {row.modeChanged ? ' Specialty behavior changed.' : ''}
                          {row.addedPositionIds.length
                            ? ` Added opportunities: ${row.addedPositionIds.join(', ')}.`
                            : ''}
                          {row.removedPositionIds.length
                            ? ` Removed opportunities: ${row.removedPositionIds.join(', ')}.`
                            : ''}
                        </li>
                      ))}
                  </ul>
                )}
                {!!comparison.eligibility.incomparable.addedPositionIds.length && (
                  <p className="break-words text-sm">
                    Added opportunities:{' '}
                    {comparison.eligibility.incomparable.addedPositionIds.join(', ')}
                  </p>
                )}
                {!!comparison.eligibility.incomparable.removedPositionIds.length && (
                  <p className="break-words text-sm">
                    Removed opportunities:{' '}
                    {comparison.eligibility.incomparable.removedPositionIds.join(', ')}
                  </p>
                )}
                <details>
                  <summary className="min-h-11 content-center cursor-pointer">
                    Changed eligibility and priority
                  </summary>
                  <p className="text-xs text-muted-foreground">
                    Policy changes hold the new evidence and participant group constant.
                    Evidence/group changes hold the prior requirements constant; they can come from
                    draft dates or participation settings without changing Department records. Equal
                    configured tie breaks share a priority.
                  </p>
                  <ul className="space-y-3">
                    {comparison.eligibility.changes.map((change) => (
                      <li
                        key={`${change.cause}-${change.positionId}-${change.memberId}`}
                        className="rounded border border-border p-3 text-sm"
                      >
                        <strong>
                          {names.get(change.memberId) ?? `Member ${change.memberId}`} ·{' '}
                          {change.positionId}
                        </strong>
                        <p>
                          {change.cause === 'EVIDENCE' ? 'Evidence/group' : 'Policy'}:{' '}
                          {change.before.eligible ? 'Eligible' : 'Ineligible'} →{' '}
                          {change.after.eligible ? 'Eligible' : 'Ineligible'}; points{' '}
                          {change.before.points} → {change.after.points}; priority{' '}
                          {change.before.priority ?? 'None'} → {change.after.priority ?? 'None'}.
                        </p>
                        <Button
                          type="button"
                          disabled={locked}
                          onClick={() => {
                            setMember(String(change.memberId));
                            setPosition(change.positionId);
                            setOtherMember('');
                            void evaluate(comparison.eligibility.changeOffset, {
                              memberId: change.memberId,
                              positionId: change.positionId,
                            });
                          }}
                        >
                          Inspect decision
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {comparison.eligibility.changeOffset > 0 && (
                    <Button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        void evaluate(
                          Math.max(0, comparison.eligibility.changeOffset - 100),
                          undefined,
                          true,
                        )
                      }
                    >
                      Previous changes
                    </Button>
                  )}
                  {comparison.eligibility.nextChangeOffset !== null && (
                    <Button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        void evaluate(comparison.eligibility.nextChangeOffset as number)
                      }
                    >
                      Next changes
                    </Button>
                  )}
                </details>
              </>
            ) : (
              <p className="font-medium">
                The comparison is unavailable until both definitions can be evaluated. No missing
                result has been treated as zero.
              </p>
            )}
            {!!opportunities.length && (
              <details>
                <summary className="min-h-11 content-center cursor-pointer">
                  Eligibility by opportunity
                </summary>
                <TextField
                  label="Find evaluated opportunity"
                  value={query}
                  onChange={(value) => {
                    setQuery(value);
                    setOpportunityPage(0);
                  }}
                />
                <ul className="space-y-2 text-sm">
                  {opportunities
                    .slice(visibleOpportunityPage * 20, (visibleOpportunityPage + 1) * 20)
                    .map((id) => (
                      <li key={id} className="break-words">
                        <strong>{id}</strong>:{' '}
                        {beforeCounts.get(id)?.eligibleMemberCount ?? 'Not evaluated'} →{' '}
                        {afterCounts.get(id)?.eligibleMemberCount ?? 'Not evaluated'} eligible
                        members
                      </li>
                    ))}
                </ul>
                {visibleOpportunityPage > 0 && (
                  <Button
                    type="button"
                    onClick={() => setOpportunityPage(visibleOpportunityPage - 1)}
                  >
                    Previous opportunities
                  </Button>
                )}
                {(visibleOpportunityPage + 1) * 20 < opportunities.length && (
                  <Button
                    type="button"
                    onClick={() => setOpportunityPage(visibleOpportunityPage + 1)}
                  >
                    Next opportunities
                  </Button>
                )}
              </details>
            )}
            <details>
              <summary className="min-h-11 content-center cursor-pointer">
                Calculation evidence
              </summary>
              <dl className="space-y-2 break-all text-xs">
                <dt>Saved policy hash</dt>
                <dd>{current.source.baselineContentSha256}</dd>
                <dt>Draft policy hash</dt>
                <dd>{current.source.candidateContentSha256}</dd>
                <dt>Comparison hash</dt>
                <dd>{current.impactSha256 ?? 'Unavailable: one side could not be evaluated'}</dd>
              </dl>
            </details>
          </>
        )}
      </FieldSection>
      {current && (
        <FieldSection
          title="Rule / decision trace"
          description="Inspect the actual server decisions for one person and opportunity. Choose a comparison member to follow the configured tie break."
        >
          <ReferencePicker
            label="Trace member"
            values={member ? [member] : []}
            options={members.map((row) => ({
              value: String(row.memberId),
              label: `${names.get(row.memberId)} · ${row.rank}`,
            }))}
            onChange={(values) => setMember(values.at(-1) ?? '')}
          />
          <ReferencePicker
            label="Trace opportunity"
            values={position ? [position] : []}
            options={content.positions.map((row) => ({
              value: row.id,
              label: `${row.id} · ${row.positionName}`,
            }))}
            onChange={(values) => setPosition(values.at(-1) ?? '')}
          />
          <ReferencePicker
            label="Comparison member (optional)"
            values={otherMember ? [otherMember] : []}
            options={members.map((row) => ({
              value: String(row.memberId),
              label: names.get(row.memberId) ?? String(row.memberId),
            }))}
            onChange={(values) => setOtherMember(values.at(-1) ?? '')}
          />
          <Button
            type="button"
            disabled={locked || !member || !position}
            onClick={() =>
              void evaluate(comparison?.eligibility.changeOffset ?? 0, {
                memberId: Number(member),
                positionId: position,
                ...(otherMember ? { compareMemberId: Number(otherMember) } : {}),
              })
            }
          >
            Show decision trace
          </Button>
          {current.trace && (
            <>
              <h3 ref={traceHeading} tabIndex={-1} className="scroll-mt-24 font-medium">
                {names.get(current.trace.selection.memberId) ??
                  `Member ${current.trace.selection.memberId}`}{' '}
                · {current.trace.selection.positionId}
              </h3>
              <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                <TraceCard title="Saved policy decision" trace={current.trace.before} />
                <TraceCard title="Draft decision" trace={current.trace.after} />
              </div>
            </>
          )}
        </FieldSection>
      )}
    </div>
  );
}
