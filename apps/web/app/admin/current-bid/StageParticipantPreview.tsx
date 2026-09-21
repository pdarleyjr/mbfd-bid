'use client';

import { Button } from '@/components/ui/button';
import {
  type BidDefinitionContent,
  type BidStageParticipantPreviewResponse,
  BidStageParticipantPreviewResponseSchema,
} from '@mbfd/shared';
import { useEffect, useRef, useState } from 'react';
import { FieldSection } from './BidFields';
import { type BidExpected, BidRequestError, bidRequest } from './bid-client';

type ValidPreview = Extract<BidStageParticipantPreviewResponse, { valid: true }>;

const words = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const explanations: Record<string, string> = {
  ordering_authority_unconfigured:
    'Add the governing annual-policy comparator request before preparing a run.',
  ordering_authority_source_decision_missing:
    'The governing comparator request no longer identifies a current annual-policy decision.',
  ordering_authority_source_decision_unresolved:
    'The governing annual-policy comparator decision is still awaiting resolution.',
  ordering_authority_comparator_mismatch:
    'The resolved annual-policy comparator does not match this draft request.',
  stage_authoring_ordering_authority_unresolved:
    'The governing annual-policy comparator is unresolved, so later run preparation remains blocked.',
  stage_member_population_mismatch:
    'The typed sources do not cover the evaluated participant population exactly once.',
  stage_member_reference_invalid:
    'A typed source names a member outside the evaluated participant population.',
  stage_seniority_tie: 'The authoritative comparison still ties and needs evidence review.',
  stage_ordering_fact_missing:
    'A required ordering fact is absent from the captured Department evidence.',
  stage_ordering_tie: 'The configured ordering still ties and needs evidence review.',
  bid_definition_or_source_changed:
    'The saved Bid or Department evidence changed. Refresh and preview again.',
};

const explain = (code: string) => explanations[code] ?? words(code);

const rankLabels: Record<string, string> = {
  CHIEF: 'Chief',
  DEP_CHIEF: 'Deputy Chief',
  DC: 'Division Chief',
  CPT: 'Captain',
  LT: 'Lieutenant',
  FF: 'Firefighter',
};

function sourceBaseLabel(stage: ValidPreview['stages'][number]) {
  const source = stage.source.participantSource;
  if (source.type === 'EXPLICIT_MEMBERS') return 'Explicit reviewed member list';
  return `Active · Biddable · ${source.ranks.map((rank) => rankLabels[rank] ?? rank).join(', ')}`;
}

function technicalComparatorLabel(stage: ValidPreview['stages'][number]) {
  return stage.source.ordering
    .map((rule) => `${words(rule.key)} ${words(rule.direction)}`)
    .join(' → ');
}

function memberLabel(memberId: number, names: ReadonlyMap<number, string | null>): string {
  return names.get(memberId) ?? `Member ID ${memberId}`;
}

function exceptionNames(stage: ValidPreview['stages'][number], memberIds: readonly number[]) {
  const names = new Map<number, string | null>([
    ...stage.matchedMembers.map((member) => [member.memberId, member.displayName] as const),
    ...(stage.exceptionMembers ?? []).map(
      (member) => [member.memberId, member.displayName] as const,
    ),
  ]);
  return memberIds.length
    ? memberIds.map((memberId) => memberLabel(memberId, names)).join(', ')
    : 'None';
}

function bidOrderLabel(stage: ValidPreview['stages'][number], year: number): string {
  const primary = stage.source.ordering[0]?.key;
  const source = stage.source.participantSource;
  const ranks = source.type === 'FILTER' ? source.ranks : [];
  const captainOrLieutenantStage =
    ranks.length > 0 && ranks.every((rank) => rank === 'CPT' || rank === 'LT');
  const firefighterStage = ranks.length > 0 && ranks.every((rank) => rank === 'FF');
  if (year === 2026 && captainOrLieutenantStage)
    return primary === 'TIME_IN_GRADE_BID_ORDINAL'
      ? 'Time-in-grade Bid order'
      : 'Review required: 2026 Captains and Lieutenants use time-in-grade Bid order';
  if (year === 2026 && firefighterStage)
    return primary === 'DEPARTMENT_SERVICE_BID_ORDINAL'
      ? 'Department-service Bid order'
      : 'Review required: 2026 Firefighters use Department-service Bid order';
  if (primary === 'TIME_IN_GRADE_BID_ORDINAL') return 'Time-in-grade Bid order';
  if (primary === 'DEPARTMENT_SERVICE_BID_ORDINAL') return 'Department-service Bid order';
  if (primary === 'RANK_SENIORITY') return 'Recorded rank seniority evidence';
  return 'Recorded seniority evidence';
}

function definitionLabel(definition: ValidPreview['definition']) {
  if (definition.kind === 'LEGACY_SOURCE')
    return `Legacy Department source ${definition.sourceToken}`;
  return `Saved version ${definition.versionId}, revision ${definition.revision}, ${definition.contentSha256}`;
}

function authorityMessage(authority: ValidPreview['orderingAuthority']) {
  if (authority.status === 'UNRESOLVED') {
    return `Governing comparator decision is awaiting resolution. ${explain(authority.code)}`;
  }
  return 'Governing comparator is resolved for later server preparation. This preview does not authorize a run.';
}

/**
 * This component deliberately has no roster query: all candidate names,
 * ranks, seniority facts, and the display sequence come from one server-side
 * captured evaluation.
 */
export function StageParticipantPreview({
  content,
  expected,
  year,
  locked,
}: {
  content: BidDefinitionContent;
  expected: BidExpected;
  year: number;
  locked: boolean;
}) {
  const hasTypedSources = (content.policy?.stageParticipantSources?.length ?? 0) > 0;
  const stamp = JSON.stringify(content);
  const [result, setResult] = useState<BidStageParticipantPreviewResponse | null>(null);
  const [resultStamp, setResultStamp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const requestSequence = useRef(0);
  const lastContentStamp = useRef(stamp);

  useEffect(() => {
    if (lastContentStamp.current === stamp) return;
    lastContentStamp.current = stamp;
    requestSequence.current += 1;
    setResult(null);
    setResultStamp(null);
    setError(null);
    setPending(false);
  }, [stamp]);

  const current = resultStamp === stamp && result?.valid ? result : null;

  async function inspectMembership() {
    if (locked || pending) return;
    const sequence = ++requestSequence.current;
    const capturedStamp = stamp;
    setPending(true);
    setError(null);
    setResult(null);
    setResultStamp(null);
    try {
      const next = await bidRequest(year, 'preview', BidStageParticipantPreviewResponseSchema, {
        body: {
          kind: 'stage-participant-membership',
          expected,
          intent: { operation: 'save', content },
        },
      });
      if (sequence !== requestSequence.current) return;
      setResult(next);
      setResultStamp(capturedStamp);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setError(
        caught instanceof BidRequestError
          ? explain(caught.code)
          : caught instanceof Error
            ? caught.message
            : 'The participant membership preview could not be completed.',
      );
    } finally {
      if (sequence === requestSequence.current) setPending(false);
    }
  }

  if (!hasTypedSources) return null;

  return (
    <div className="space-y-4">
      <FieldSection
        title="Participant membership preview"
        description="Ask the server to resolve every typed participant source against one captured Department evaluation. This review does not save a version or create a run."
      >
        <Button
          type="button"
          variant="primary"
          disabled={locked || pending}
          onClick={() => void inspectMembership()}
        >
          {pending ? 'Previewing participant membership…' : 'Preview participant membership'}
        </Button>
        <p className="text-xs text-muted-foreground">
          The browser never resolves roster membership. The server returns display-only candidates
          from its captured evaluation.
        </p>
        {error && <p role="alert">{error}</p>}
        {result && resultStamp !== stamp && (
          <p>
            The draft changed while this preview was running. Preview again for current results.
          </p>
        )}
        {resultStamp === stamp && result?.valid === false && (
          <ul className="space-y-2 text-sm" role="alert">
            {result.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                {issue.path.join(' › ')}: {issue.message}
              </li>
            ))}
          </ul>
        )}
      </FieldSection>

      {current && (
        <>
          <FieldSection title="Captured membership review">
            <p className="text-sm">
              Captured {new Date(current.capturedAtMs).toLocaleString()}.{' '}
              {authorityMessage(current.orderingAuthority)}
            </p>
            {current.membership.status === 'BLOCKED' ? (
              <p role="alert" className="text-sm">
                Participant membership is blocked: {explain(current.membership.code)}
                {current.membership.stageId ? ` Stage: ${current.membership.stageId}.` : ''}
                {current.membership.memberIds.length
                  ? ` Affected member IDs: ${current.membership.memberIds.join(', ')}.`
                  : ''}
              </p>
            ) : (
              <p className="text-sm">
                Preview-resolved candidate participants are shown below in display-only member-ID
                order. That sequence is not a run order.
              </p>
            )}
            <p className="text-sm">
              Participant execution readiness:{' '}
              {current.executionReady ? 'ready for later server preparation' : 'not ready'}.
              {!current.executionReady && current.executionIssues.length > 0
                ? ` ${current.executionIssues.map(explain).join(' ')}`
                : ''}
            </p>
            <p className="text-sm font-medium">
              This preview does not create, approve, or authorize a Bid run.
            </p>
            <details>
              <summary className="min-h-11 content-center cursor-pointer">Server evidence</summary>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p className="break-all">Definition: {definitionLabel(current.definition)}</p>
                <p className="break-all">
                  Candidate: {words(current.source.kind)} · baseline{' '}
                  {current.source.baselineContentSha256}
                  {' · '}candidate {current.source.candidateContentSha256}
                </p>
                <p className="break-all">
                  Captured context {current.contextSha256} · runtime source{' '}
                  {current.runtimeSourceToken}
                  {' · '}preview {current.participantPreviewSha256}
                </p>
                {current.orderingAuthority.request && (
                  <p>
                    Governing decision request: {current.orderingAuthority.request.sourceDecisionId}
                  </p>
                )}
              </div>
            </details>
          </FieldSection>

          {current.stages.map((stage) => (
            <FieldSection key={stage.stageId} title={`Preview-resolved members · ${stage.label}`}>
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,max-content)_minmax(0,1fr)]">
                <dt className="font-medium">Base: </dt>
                <dd>{sourceBaseLabel(stage)}</dd>
                <dt className="font-medium">Explicit includes: </dt>
                <dd>
                  {stage.source.participantSource.type === 'FILTER'
                    ? exceptionNames(stage, stage.source.participantSource.includeMemberIds ?? [])
                    : 'Not used for an explicit member list'}
                </dd>
                <dt className="font-medium">Explicit exclusions: </dt>
                <dd>
                  {stage.source.participantSource.type === 'FILTER'
                    ? exceptionNames(stage, stage.source.participantSource.excludeMemberIds ?? [])
                    : 'Not used for an explicit member list'}
                </dd>
                <dt className="font-medium">Resolved participants: </dt>
                <dd>{stage.matchedMembers.length}</dd>
                <dt className="font-medium">Bid order: </dt>
                <dd>{bidOrderLabel(stage, year)}</dd>
              </dl>
              <p className="mt-3 text-sm">
                {current.orderingAuthority.status === 'UNRESOLVED'
                  ? 'The governing Bid-order decision still needs review before a run can be prepared.'
                  : 'The governing Bid-order decision is resolved for later server preparation.'}
              </p>
              <details>
                <summary className="min-h-11 content-center cursor-pointer">
                  Details and captured evidence
                </summary>
                <p className="mt-2 text-sm">Policy source: {stage.source.sourceRef}</p>
                <p className="mt-2 text-sm">
                  Matched participant IDs: {stage.matchedMemberIds.join(', ')}. Display-only
                  member-ID order, captured {new Date(current.capturedAtMs).toLocaleString()}.
                </p>
                <p className="mt-2 text-sm">
                  Comparator evidence: {technicalComparatorLabel(stage)}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {stage.matchedMembers.map((member) => (
                    <li key={member.memberId}>
                      {member.displayName ?? 'Name unavailable from captured evidence'} · ID{' '}
                      {member.memberId} · {rankLabels[member.rank] ?? member.rank} · Recorded
                      seniority {member.rscSeniority} · Recorded rank seniority{' '}
                      {member.rankSeniority ?? 'not captured'}
                    </li>
                  ))}
                </ul>
              </details>
            </FieldSection>
          ))}
        </>
      )}
    </div>
  );
}
