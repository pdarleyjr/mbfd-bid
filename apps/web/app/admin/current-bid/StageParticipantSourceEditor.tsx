'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  BIDDING_RANKS,
  type BidDefinitionSourceDecision,
  type BidOrderingAuthorityRequest,
  BidOrderingAuthorityRequestSchema,
  type BidOrderingComparator,
  type StageParticipantSourceDefinition,
  StageParticipantSourceDefinitionSchema,
  bidOrderingComparatorForStage,
} from '@mbfd/shared';
import { useEffect, useId, useMemo, useState } from 'react';
import { CheckField, TextField } from './BidFields';

type ParticipantSourceType = 'EXPLICIT_MEMBERS' | 'FILTER';
type ComparatorRule = BidOrderingComparator[number];
type ComparatorKey = ComparatorRule['key'];
const comparatorLabels: Record<ComparatorKey, string> = {
  RSC_SENIORITY: 'RSC seniority',
  RANK_SENIORITY: 'Rank seniority',
  TIME_IN_GRADE_BID_ORDINAL: 'Time-in-grade Bid ordinal',
  DEPARTMENT_SERVICE_BID_ORDINAL: 'Department-service Bid ordinal',
};
type ComparatorDirection = ComparatorRule['direction'];
type ComparatorDraftRule = { key: ComparatorKey | ''; direction: ComparatorDirection | '' };

type ParticipantSourceDraft = {
  sourceRef: string;
  type: ParticipantSourceType;
  explicitMemberIds: string;
  ranks: string[];
};

function sameOrdering(
  left: StageParticipantSourceDefinition['ordering'],
  right: BidOrderingComparator | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseExplicitMemberIds(value: string): number[] | undefined {
  const entries = value.split(',').map((entry) => entry.trim());
  if (!entries.length || entries.some((entry) => !/^\d+$/.test(entry))) return undefined;
  const memberIds = entries.map(Number);
  return memberIds.every((memberId) => Number.isSafeInteger(memberId) && memberId > 0)
    ? memberIds
    : undefined;
}

function sourceDraft(
  definition: StageParticipantSourceDefinition | undefined,
): ParticipantSourceDraft {
  if (definition?.participantSource.type === 'FILTER')
    return {
      sourceRef: definition.sourceRef,
      type: 'FILTER',
      explicitMemberIds: '',
      ranks: [...definition.participantSource.ranks],
    };
  return {
    sourceRef: definition?.sourceRef ?? '',
    type: 'EXPLICIT_MEMBERS',
    explicitMemberIds:
      definition?.participantSource.type === 'EXPLICIT_MEMBERS'
        ? definition.participantSource.memberIds.join(', ')
        : '',
    ranks: [],
  };
}

function stageSourceCandidate(input: {
  stageId: string;
  draft: ParticipantSourceDraft;
  orderingAuthority: BidOrderingAuthorityRequest | undefined;
}): StageParticipantSourceDefinition | undefined {
  if (!input.orderingAuthority) return undefined;
  const participantSource =
    input.draft.type === 'EXPLICIT_MEMBERS'
      ? (() => {
          const memberIds = parseExplicitMemberIds(input.draft.explicitMemberIds);
          return memberIds === undefined
            ? undefined
            : { type: 'EXPLICIT_MEMBERS' as const, memberIds };
        })()
      : {
          type: 'FILTER' as const,
          active: true as const,
          bidParticipation: 'BIDDABLE' as const,
          ranks: input.draft.ranks,
        };
  if (!participantSource) return undefined;
  const parsed = StageParticipantSourceDefinitionSchema.safeParse({
    stageId: input.stageId,
    sourceRef: input.draft.sourceRef,
    participantSource,
    ordering: bidOrderingComparatorForStage(input.orderingAuthority, input.stageId),
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Edits a source definition as local draft material until it validates against
 * the shared schema. This component deliberately never queries the current
 * roster or resolves a selector: only a later pinned server compilation may do
 * that from a frozen Bid evaluation.
 */
export function StageParticipantSourceEditor({
  stageId,
  savedDefinition,
  orderingAuthority,
  orderingAuthorityAvailable = true,
  executionStageReady = true,
  onSave,
  onRemove,
}: {
  stageId: string;
  savedDefinition: StageParticipantSourceDefinition | undefined;
  orderingAuthority: BidOrderingAuthorityRequest | undefined;
  /** The request must still point to an existing annual-policy decision. */
  orderingAuthorityAvailable?: boolean;
  /** The current frozen execution-stage schema still requires real member refs. */
  executionStageReady?: boolean;
  onSave(definition: StageParticipantSourceDefinition): void;
  onRemove(): void;
}) {
  const [draft, setDraft] = useState(() => sourceDraft(savedDefinition));
  const savedDraftKey = JSON.stringify({
    definition: savedDefinition ?? null,
    draft: sourceDraft(savedDefinition),
  });
  // Parent editors may reconstruct the saved object after unrelated field
  // changes. Only an actual saved definition change may replace this local
  // unfinished draft.
  useEffect(
    () => setDraft((JSON.parse(savedDraftKey) as { draft: ParticipantSourceDraft }).draft),
    [savedDraftKey],
  );
  const staleOrderingKey =
    savedDefinition && orderingAuthority && orderingAuthorityAvailable
      ? sameOrdering(
          savedDefinition.ordering,
          bidOrderingComparatorForStage(orderingAuthority, stageId),
        )
        ? ''
        : JSON.stringify({
            savedOrdering: savedDefinition.ordering,
            requestedOrdering: bidOrderingComparatorForStage(orderingAuthority, stageId),
          })
      : '';
  const [orderingReviewed, setOrderingReviewed] = useState(() => staleOrderingKey === '');
  useEffect(() => setOrderingReviewed(staleOrderingKey === ''), [staleOrderingKey]);
  const needsOrderingReview = staleOrderingKey !== '';
  const candidate = useMemo(
    () =>
      stageSourceCandidate({
        stageId,
        draft,
        orderingAuthority: orderingAuthorityAvailable ? orderingAuthority : undefined,
      }),
    [draft, orderingAuthority, orderingAuthorityAvailable, stageId],
  );
  const canSave =
    executionStageReady && candidate !== undefined && (!needsOrderingReview || orderingReviewed);

  return (
    <section
      className="space-y-3 rounded border border-border bg-muted/20 p-3"
      aria-label="Stage participant source"
    >
      <div>
        <h4 className="font-medium">Participant source</h4>
        <p className="text-sm text-muted-foreground">
          This records an authored selector for a later frozen evaluation. No browser roster lookup
          or Live operation occurs here.
        </p>
      </div>
      <ParticipantSourceTypeField
        value={draft.type}
        onChange={(type) =>
          setDraft((current) => ({ ...current, type, explicitMemberIds: '', ranks: [] }))
        }
      />
      <TextField
        label="Source reference"
        value={draft.sourceRef}
        onChange={(sourceRef) => setDraft((current) => ({ ...current, sourceRef }))}
        help="Name the reviewed policy material. This reference is provenance, not a roster query."
      />
      {draft.type === 'EXPLICIT_MEMBERS' ? (
        <TextField
          label="Explicit member IDs"
          value={draft.explicitMemberIds}
          onChange={(explicitMemberIds) =>
            setDraft((current) => ({ ...current, explicitMemberIds }))
          }
          help="Comma-separated positive Department member IDs. IDs must be unique; they are not resolved in this browser."
        />
      ) : (
        <FilterRanks
          values={draft.ranks}
          onChange={(ranks) => setDraft((current) => ({ ...current, ranks }))}
        />
      )}
      {orderingAuthority && orderingAuthorityAvailable ? (
        <p className="text-sm text-muted-foreground">
          This source will use the saved governing comparator request:{' '}
          {formatComparator(bidOrderingComparatorForStage(orderingAuthority, stageId) ?? [])}.
        </p>
      ) : orderingAuthority ? (
        <p role="alert" className="text-sm text-destructive">
          The saved governing comparator request no longer points to an available annual-policy
          source decision. This local draft remains unresolved.
        </p>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          A saved governing comparator request is required before a participant source can be saved.
          This local draft remains unresolved.
        </p>
      )}
      {!executionStageReady ? (
        <output className="block text-sm text-destructive">
          This stage has no explicit frozen participant references, which the current execution
          schema requires. Keep this selector draft local until real references are available; do
          not add placeholder member IDs.
          {needsOrderingReview
            ? ' Its saved selector ordering is also stale and must be reviewed and re-saved after that structural blocker is cleared.'
            : ''}
        </output>
      ) : needsOrderingReview ? (
        <output className="block text-sm text-destructive">
          Saved selector ordering is stale and unresolved because it does not match the current
          governing comparator request. Review the comparator, then explicitly re-save this stage;
          it cannot cover this stage for selector-based server acceptance until then.
          {orderingReviewed ? ' Comparator review recorded locally; re-save remains required.' : ''}
        </output>
      ) : candidate ? (
        <output className="block text-sm text-muted-foreground">
          Valid local stage draft. Save records only this stage as definition material; it does not
          resolve membership, accept a version, or authorize Live operation.
        </output>
      ) : (
        <output className="block text-sm text-muted-foreground">
          Unresolved local draft — not saved to the Bid definition.
          {savedDefinition ? ' The saved participant source remains unchanged.' : ''}
        </output>
      )}
      <div className="flex flex-wrap gap-2">
        {needsOrderingReview && !orderingReviewed && (
          <Button type="button" variant="secondary" onClick={() => setOrderingReviewed(true)}>
            Review current governing comparator
          </Button>
        )}
        <Button
          type="button"
          disabled={!canSave}
          onClick={() => canSave && candidate && onSave(candidate)}
        >
          Save participant source
        </Button>
        {savedDefinition && (
          <Button type="button" variant="secondary" onClick={onRemove}>
            Remove saved participant source
          </Button>
        )}
      </div>
    </section>
  );
}

function ParticipantSourceTypeField({
  value,
  onChange,
}: {
  value: ParticipantSourceType;
  onChange(value: ParticipantSourceType): void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>Participant source type</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as ParticipantSourceType)}
      >
        <option value="EXPLICIT_MEMBERS">Explicit members</option>
        <option value="FILTER">Constrained filter</option>
      </NativeSelect>
    </div>
  );
}

function FilterRanks({
  values,
  onChange,
}: {
  values: string[];
  onChange(values: string[]): void;
}) {
  return (
    <fieldset className="space-y-2 rounded border border-border p-3">
      <legend className="px-1 font-medium">Constrained filter</legend>
      <p className="text-xs text-muted-foreground">
        The only saved predicates are active Department members, Biddable participation, and one or
        more selected ranks. SQL, custom expressions, and dynamic eligibility are unavailable.
      </p>
      <p className="text-sm">Active: yes · Bid participation: Biddable</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {BIDDING_RANKS.map((rank) => (
          <CheckField
            key={rank}
            label={rank}
            value={values.includes(rank)}
            onChange={(selected) =>
              onChange(selected ? [...values, rank] : values.filter((value) => value !== rank))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

type OrderingAuthorityDraft = {
  sourceDecisionId: string;
  primary: ComparatorDraftRule;
  secondary: ComparatorDraftRule | undefined;
};

export function BidOrderingAuthorityRequestEditor({
  sourceDecisions,
  value,
  onChange,
  stages = [],
}: {
  sourceDecisions: readonly BidDefinitionSourceDecision[];
  value: BidOrderingAuthorityRequest | undefined;
  onChange(value: BidOrderingAuthorityRequest | undefined): void;
  stages?: readonly { id: string; label: string }[];
}) {
  if (value?.v !== 2)
    return (
      <div className="space-y-3">
        <SingleOrderingAuthorityRequestEditor
          sourceDecisions={sourceDecisions}
          value={value}
          onChange={onChange}
        />
        {value && stages.length > 0 && (
          <Button
            type="button"
            onClick={() =>
              onChange({
                v: 2,
                sourceDecisionId: value.sourceDecisionId,
                stages: stages.map((stage) => ({
                  stageId: stage.id,
                  comparator: value.comparator,
                })),
              })
            }
          >
            Set seniority separately for each stage
          </Button>
        )}
      </div>
    );
  return (
    <section aria-label="Seniority by stage" className="space-y-3">
      <p>
        Each stage uses its own seniority rule. The governing source must confirm every stage before
        a run can be prepared.
      </p>
      {stages.map((stage) => {
        const comparator = bidOrderingComparatorForStage(value, stage.id);
        return (
          <details key={stage.id} className="rounded border border-border p-3">
            <summary>
              {stage.label}: {comparator ? formatComparator(comparator) : 'Ordering required'}
            </summary>
            <SingleOrderingAuthorityRequestEditor
              sourceDecisions={sourceDecisions}
              value={
                comparator
                  ? { v: 1, sourceDecisionId: value.sourceDecisionId, comparator }
                  : undefined
              }
              onChange={(request) => {
                if (request?.v !== 1) return;
                onChange({
                  ...value,
                  sourceDecisionId: request.sourceDecisionId,
                  stages: stages.flatMap((item) => {
                    const next =
                      item.id === stage.id
                        ? request.comparator
                        : bidOrderingComparatorForStage(value, item.id);
                    return next ? [{ stageId: item.id, comparator: next }] : [];
                  }),
                });
              }}
            />
          </details>
        );
      })}
      <Button type="button" onClick={() => onChange(undefined)}>
        Remove stage ordering
      </Button>
    </section>
  );
}

function comparatorRuleDraft(rule: ComparatorRule | undefined): ComparatorDraftRule {
  return { key: rule?.key ?? '', direction: rule?.direction ?? '' };
}

function orderingAuthorityDraft(
  value: Extract<BidOrderingAuthorityRequest, { v: 1 }> | undefined,
): OrderingAuthorityDraft {
  return {
    sourceDecisionId: value?.sourceDecisionId ?? '',
    primary: comparatorRuleDraft(value?.comparator[0]),
    secondary:
      value?.comparator.length === 2 ? comparatorRuleDraft(value.comparator[1]) : undefined,
  };
}

function orderingAuthorityCandidate(
  draft: OrderingAuthorityDraft,
): BidOrderingAuthorityRequest | undefined {
  const draftRules = [draft.primary, ...(draft.secondary ? [draft.secondary] : [])];
  if (
    !draft.sourceDecisionId ||
    draftRules.some((rule) => rule.key === '' || rule.direction === '')
  )
    return undefined;
  const comparator = draftRules.map((rule) => ({
    key: rule.key as ComparatorKey,
    direction: rule.direction as ComparatorDirection,
  }));
  const parsed = BidOrderingAuthorityRequestSchema.safeParse({
    v: 1,
    sourceDecisionId: draft.sourceDecisionId,
    comparator,
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Records only a request to match a comparator with an annual-policy source
 * decision. It intentionally cannot mark that decision RESOLVED or write its
 * typed resolution; server-side reconciliation owns that separate authority.
 */
function SingleOrderingAuthorityRequestEditor({
  sourceDecisions,
  value,
  onChange,
}: {
  sourceDecisions: readonly BidDefinitionSourceDecision[];
  value: Extract<BidOrderingAuthorityRequest, { v: 1 }> | undefined;
  onChange(value: BidOrderingAuthorityRequest | undefined): void;
}) {
  const [draft, setDraft] = useState(() => orderingAuthorityDraft(value));
  const savedDraftKey = JSON.stringify(orderingAuthorityDraft(value));
  // As above, a referentially new but equal policy document must not erase a
  // local, unfinished request.
  useEffect(() => setDraft(JSON.parse(savedDraftKey) as OrderingAuthorityDraft), [savedDraftKey]);
  const candidate = useMemo(() => orderingAuthorityCandidate(draft), [draft]);
  const annualPolicyDecisions = sourceDecisions.filter(
    (decision) => decision.area === 'annual-policy',
  );
  const selectedAnnualPolicyDecision = annualPolicyDecisions.some(
    (decision) => decision.issueId === draft.sourceDecisionId,
  );
  const missingSavedDecision = draft.sourceDecisionId && !selectedAnnualPolicyDecision;
  const persistableCandidate = selectedAnnualPolicyDecision ? candidate : undefined;

  return (
    <section className="space-y-3 rounded border border-border bg-muted/20 p-3">
      <div>
        <h4 className="font-medium">Governing comparator request</h4>
        <p className="text-sm text-muted-foreground">
          This is an unverified request and cannot authorize Live operation. A separate reviewed
          source decision must later resolve the exact comparator before it can be frozen.
        </p>
      </div>
      <SourceDecisionPicker
        decisions={annualPolicyDecisions}
        missingSavedDecision={missingSavedDecision ? draft.sourceDecisionId : undefined}
        value={draft.sourceDecisionId}
        onChange={(sourceDecisionId) => setDraft((current) => ({ ...current, sourceDecisionId }))}
      />
      <ComparatorRuleEditor
        label="Primary comparator"
        value={draft.primary}
        exclude={[]}
        onChange={(primary) => setDraft((current) => ({ ...current, primary }))}
      />
      {draft.secondary ? (
        <>
          <ComparatorRuleEditor
            label="Secondary comparator"
            value={draft.secondary}
            exclude={draft.primary.key ? [draft.primary.key] : []}
            onChange={(secondary) => setDraft((current) => ({ ...current, secondary }))}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDraft((current) => ({ ...current, secondary: undefined }))}
          >
            Remove comparator tie-breaker
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              secondary: { key: '', direction: '' },
            }))
          }
        >
          Add comparator tie-breaker
        </Button>
      )}
      {persistableCandidate ? (
        <output className="block text-sm text-muted-foreground">
          Valid local request. Saving does not resolve the source decision or authorize Live
          operation.
        </output>
      ) : (
        <output className="block text-sm text-muted-foreground">
          Unresolved local request — not saved to the Bid definition.
          {value ? ' The saved comparator request remains unchanged.' : ''}
        </output>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!persistableCandidate}
          onClick={() => persistableCandidate && onChange(persistableCandidate)}
        >
          Save governing comparator request
        </Button>
        {value && (
          <Button type="button" variant="secondary" onClick={() => onChange(undefined)}>
            Remove governing comparator request
          </Button>
        )}
      </div>
    </section>
  );
}

function SourceDecisionPicker({
  decisions,
  missingSavedDecision,
  value,
  onChange,
}: {
  decisions: readonly BidDefinitionSourceDecision[];
  missingSavedDecision: string | undefined;
  value: string;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>Governing source decision</Label>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select an annual-policy source decision</option>
        {missingSavedDecision && (
          <option value={missingSavedDecision}>
            {missingSavedDecision} · Saved request; annual-policy review required
          </option>
        )}
        {decisions.map((decision) => (
          <option key={decision.issueId} value={decision.issueId}>
            {decision.title || decision.issueId} ·{' '}
            {decision.status === 'RESOLVED' ? 'Resolved' : 'Open'}
          </option>
        ))}
      </NativeSelect>
      {!decisions.length && (
        <p className="text-xs text-muted-foreground">
          Add an annual-policy source decision in Policy & language before saving a comparator
          request.
        </p>
      )}
    </div>
  );
}

function ComparatorRuleEditor({
  label,
  value,
  exclude,
  onChange,
}: {
  label: 'Primary comparator' | 'Secondary comparator';
  value: ComparatorDraftRule;
  exclude: readonly (ComparatorKey | '')[];
  onChange(value: ComparatorDraftRule): void;
}) {
  const keyId = useId();
  const directionId = useId();
  const availableKeys = (
    [
      'RSC_SENIORITY',
      'RANK_SENIORITY',
      'TIME_IN_GRADE_BID_ORDINAL',
      'DEPARTMENT_SERVICE_BID_ORDINAL',
    ] as const
  ).filter((key) => !exclude.includes(key) || value.key === key);
  return (
    <fieldset className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
      <legend className="px-1 font-medium">{label}</legend>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={keyId}>{label} key</Label>
        <NativeSelect
          id={keyId}
          value={value.key}
          onChange={(event) =>
            onChange({ ...value, key: event.target.value as ComparatorKey | '' })
          }
        >
          <option value="">Select comparator key</option>
          {availableKeys.map((key) => (
            <option key={key} value={key}>
              {comparatorLabels[key]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={directionId}>{label} direction</Label>
        <NativeSelect
          id={directionId}
          value={value.direction}
          onChange={(event) =>
            onChange({ ...value, direction: event.target.value as ComparatorDirection | '' })
          }
        >
          <option value="">Select direction</option>
          <option value="ASC">Ascending</option>
          <option value="DESC">Descending</option>
        </NativeSelect>
      </div>
    </fieldset>
  );
}

function formatComparator(comparator: BidOrderingComparator): string {
  return comparator
    .map(
      (rule) =>
        `${comparatorLabels[rule.key]} ${rule.direction === 'ASC' ? 'ascending' : 'descending'}`,
    )
    .join(', then ');
}
