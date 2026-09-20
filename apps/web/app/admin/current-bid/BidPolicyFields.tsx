'use client';
import { ConfiguredScoringEditor } from '@/app/admin/positions/[id]/edit/ConfiguredScoringEditor';
import { Button } from '@/components/ui/button';
import { useCredentialCatalog } from '@/lib/use-credential-catalog';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  type BidOrderingAuthorityRequest,
  type FrozenLiveBidPolicy,
  LiveBidActionSchema,
  type StageParticipantSourceDefinition,
  bidOrderingComparatorForStage,
} from '@mbfd/shared';
import { BidADayExecutionFields } from './BidADayExecutionFields';
import { BidAssignmentTermFields } from './BidAssignmentTermFields';
import { BidFallbackFields } from './BidFallbackFields';
import {
  CheckField,
  ChoiceField,
  FieldSection,
  NullableText,
  NumberField,
  OrderedChoices,
  ReferencePicker,
  TextEntries,
  TextField,
  useBidMembers,
} from './BidFields';
import { BidMembershipFields } from './BidMembershipFields';
import { BidOpportunityPoolFields } from './BidOpportunityPoolFields';
import { BidPolicySourceFields } from './BidPolicySourceFields';
import { PendingPolicyReview } from './PendingPolicyReview';
import {
  BidOrderingAuthorityRequestEditor,
  StageParticipantSourceEditor,
} from './StageParticipantSourceEditor';

export type PolicySection =
  | 'language'
  | 'flow'
  | 'contact'
  | 'specialties'
  | 'a-day'
  | 'authority'
  | 'timing';
type Policy = FrozenLiveBidPolicy;
type PolicyDocument = NonNullable<BidDefinitionContent['policy']>;

function withoutStageParticipantSource(policy: PolicyDocument, stageId: string): PolicyDocument {
  const remaining = policy.stageParticipantSources?.filter(
    (definition) => definition.stageId !== stageId,
  );
  if (remaining?.length) return { ...policy, stageParticipantSources: remaining };
  const { stageParticipantSources: _stageParticipantSources, ...withoutSources } = policy;
  return withoutSources;
}

function withStageParticipantSource(
  policy: PolicyDocument,
  definition: StageParticipantSourceDefinition,
): PolicyDocument {
  const existing = policy.stageParticipantSources ?? [];
  const hasExisting = existing.some((candidate) => candidate.stageId === definition.stageId);
  return {
    ...policy,
    stageParticipantSources: hasExisting
      ? existing.map((candidate) =>
          candidate.stageId === definition.stageId ? definition : candidate,
        )
      : [...existing, definition],
  };
}

function withOrderingAuthorityRequest(
  policy: PolicyDocument,
  request: BidOrderingAuthorityRequest | undefined,
): PolicyDocument {
  if (request) return { ...policy, orderingAuthority: request };
  const { orderingAuthority: _orderingAuthority, ...withoutRequest } = policy;
  return withoutRequest;
}

function sameStageParticipantOrdering(
  left: StageParticipantSourceDefinition['ordering'],
  right: StageParticipantSourceDefinition['ordering'] | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function StageParticipantSourceCoverageNotice({
  stages,
  definitions,
  orderingAuthority,
  orderingAuthorityAvailable,
}: {
  stages: Policy['stages'];
  definitions: readonly StageParticipantSourceDefinition[];
  orderingAuthority: BidOrderingAuthorityRequest | undefined;
  orderingAuthorityAvailable: boolean;
}) {
  const configuredStageIds = new Set(stages.map((stage) => stage.id));
  const unexpectedStageIds = definitions
    .filter((definition) => !configuredStageIds.has(definition.stageId))
    .map((definition) => definition.stageId);
  const executionStageBlocked = stages.filter((stage) => stage.memberIds.length === 0);
  if (!stages.length)
    return (
      <p className="text-sm text-muted-foreground">
        {unexpectedStageIds.length
          ? `Selector coverage is partial. Unexpected saved source stage IDs: ${unexpectedStageIds.join(', ')}. Remove or remap them before server acceptance.`
          : 'No configured stages yet. There is no selector coverage to save, accept, or use for Live operation.'}
      </p>
    );
  if (!definitions.length)
    return (
      <p className="text-sm text-muted-foreground">
        Selector coverage is partial. No saved typed selector sources exist. Legacy absence is
        retained, but a current governing comparator request and a matching typed source for every
        configured stage are required for selector-based server acceptance.
        {executionStageBlocked.length > 0
          ? ` Frozen execution participant references are absent for ${executionStageBlocked
              .map((stage) => stage.label || stage.id)
              .join(', ')}; do not add placeholders.`
          : ''}
      </p>
    );
  if (!orderingAuthority || !orderingAuthorityAvailable)
    return (
      <p className="text-sm text-destructive">
        Typed selector sources are retained but unbound and Live-blocked because no current
        governing comparator request is available. They do not count as selector coverage or
        server-acceptable selector authoring until a valid request is saved and each stage is
        reviewed against it.
        {unexpectedStageIds.length
          ? ` Unexpected saved source stage IDs: ${unexpectedStageIds.join(', ')}.`
          : ''}
      </p>
    );
  const matchingStageIds = new Set(
    definitions
      .filter((definition) =>
        sameStageParticipantOrdering(
          definition.ordering,
          bidOrderingComparatorForStage(orderingAuthority, definition.stageId),
        ),
      )
      .map((definition) => definition.stageId),
  );
  const missingStages = stages.filter((stage) => !matchingStageIds.has(stage.id));
  const staleStageIds = new Set(
    definitions
      .filter(
        (definition) =>
          stages.some((stage) => stage.id === definition.stageId) &&
          !sameStageParticipantOrdering(
            definition.ordering,
            bidOrderingComparatorForStage(orderingAuthority, definition.stageId),
          ),
      )
      .map((definition) => definition.stageId),
  );
  const staleStages = stages.filter((stage) => staleStageIds.has(stage.id));
  if (!missingStages.length && !unexpectedStageIds.length && !executionStageBlocked.length)
    return (
      <p className="text-sm text-muted-foreground">
        Typed selector sources cover every configured stage locally. Server acceptance and Live
        authority still require separate server-side review and freeze.
      </p>
    );
  return (
    <p className="text-sm text-muted-foreground">
      Selector coverage is partial.
      {missingStages.length > 0 && (
        <>
          {' '}
          {missingStages.map((stage) => stage.label || stage.id).join(', ')}{' '}
          {missingStages.length === 1 ? 'has' : 'have'} no matching saved typed source.
        </>
      )}
      {staleStages.length > 0 && (
        <>
          {' '}
          Saved selector ordering is stale for{' '}
          {staleStages.map((stage) => stage.label || stage.id).join(', ')} and must be reviewed and
          re-saved.
        </>
      )}
      {unexpectedStageIds.length > 0 && (
        <> Unexpected saved source stage IDs: {unexpectedStageIds.join(', ')}.</>
      )}
      {executionStageBlocked.length > 0 && (
        <>
          {' '}
          Frozen execution participant references are absent for{' '}
          {executionStageBlocked.map((stage) => stage.label || stage.id).join(', ')}. Do not add
          placeholders; their selectors remain local until real references are available.
        </>
      )}{' '}
      Legacy absence is retained, but selector-based server acceptance requires a matching typed
      source for every configured stage. Saving one stage here does not accept a version or
      authorize Live.
    </p>
  );
}

export function emptyOperatingPolicy(): Policy {
  return {
    v: 1,
    policyRevision: '',
    stages: [],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: false,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: false,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
}
export function emptyAnnualOperations(policy: Policy): NonNullable<Policy['annualOperations']> {
  return {
    v: 1,
    stageOrder: [...policy.stages].sort((a, b) => a.order - b.order).map((s) => s.id),
    requiredTopologyPositionIds: [],
    contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
    aDay: {
      combatGroups: ['G1', 'G2', 'G3', 'G4'],
      min: 0,
      max: 0,
      captainDcMax: 0,
      specialtyMaximums: { MARINE_ASSIGNED: 0, MARINE_FLOAT: 0, DE: 0, SWAT: 0 },
    },
  };
}
export function BidPolicyFields({
  content,
  section,
  onChange,
}: {
  content: BidDefinitionContent;
  section: PolicySection;
  onChange(content: BidDefinitionContent): void;
}) {
  const people = useBidMembers();
  const credentials = useCredentialCatalog();
  const policy = content.settings?.v === 3 ? content.settings.livePolicy : null;
  const orderingAuthorityRequest = content.policy?.orderingAuthority;
  const orderingAuthorityAvailable =
    orderingAuthorityRequest !== undefined &&
    content.sourceDecisions.some(
      (decision) =>
        decision.issueId === orderingAuthorityRequest.sourceDecisionId &&
        decision.area === 'annual-policy',
    );
  const opportunities = content.positions.map((p) => ({
    value: p.id,
    label: `${p.positionName} · ${p.shift} · ${p.id}`,
  }));
  const updatePolicy = (
    next: Policy,
    policyDocument: BidDefinitionContent['policy'] = content.policy,
  ) => {
    if (content.settings?.v !== 3) return;
    onChange({
      ...content,
      settings: { ...content.settings, livePolicy: next },
      policy: policyDocument ? { ...policyDocument, executionPolicy: next } : null,
    });
  };
  const updatePolicyDocument = (next: PolicyDocument) => onChange({ ...content, policy: next });
  const saveStageParticipantSource = (definition: StageParticipantSourceDefinition) => {
    if (!content.policy) return;
    updatePolicyDocument(withStageParticipantSource(content.policy, definition));
  };
  const removeStageParticipantSource = (stageId: string) => {
    if (!content.policy) return;
    updatePolicyDocument(withoutStageParticipantSource(content.policy, stageId));
  };
  const updateOrderingAuthorityRequest = (request: BidOrderingAuthorityRequest | undefined) => {
    if (!content.policy) return;
    updatePolicyDocument(withOrderingAuthorityRequest(content.policy, request));
  };
  const ops = policy?.annualOperations;
  const initializePolicy = () => {
    const prior = content.settings;
    const livePolicy = emptyOperatingPolicy();
    onChange({
      ...content,
      settings: {
        ...(prior ?? { expectedDurationDays: 0, turnTimerSeconds: 0 }),
        v: 3,
        credentialEvaluationOn: prior && prior.v !== 1 ? prior.credentialEvaluationOn : '',
        livePolicy,
      },
    });
  };
  const changeOps = (next: NonNullable<Policy['annualOperations']>) => {
    if (policy) updatePolicy({ ...policy, annualOperations: next });
  };
  if (section === 'language' || section === 'timing')
    return <BidPolicySourceFields {...{ content, section, policy, updatePolicy, onChange }} />;
  if (!policy && content.pendingPolicy)
    return <PendingPolicyReview content={content} onChange={onChange} />;
  if (!policy)
    return (
      <FieldSection title="Operating policy not configured">
        <p className="text-sm">
          This Bid has no structured operating policy. Its existing rules and source material are
          retained.
        </p>
        <p className="text-sm">
          Configure the operating policy and explicit action permissions before creating a Live Bid.
        </p>
        <Button type="button" onClick={initializePolicy}>
          Configure operating policy
        </Button>
        <p className="text-xs text-muted-foreground">
          The new policy starts incomplete and grants no action permissions. Enter the approved
          procedures, dates, participants and authorities before saving.
        </p>
      </FieldSection>
    );
  if (!ops && ['contact', 'a-day', 'specialties'].includes(section))
    return (
      <FieldSection title="Configure operating procedures">
        <p className="text-sm">
          This older policy has no contact, specialty or A-Day configuration. Existing stages and
          action permissions are retained.
        </p>
        <Button
          type="button"
          onClick={() =>
            updatePolicy({ ...policy, annualOperations: emptyAnnualOperations(policy) })
          }
        >
          Add operating procedures
        </Button>
        <p className="text-xs text-muted-foreground">
          Review the contact procedure and every capacity limit, then select the required specialty
          opportunities.
        </p>
      </FieldSection>
    );
  if (section === 'flow')
    return (
      <FieldSection
        title="Participants & Bid flow"
        description="Each stage names its participants and opportunities. Members retain their Department identity. Move stages to change their configured order."
      >
        {content.policy ? (
          <>
            <BidOrderingAuthorityRequestEditor
              stages={policy.stages}
              sourceDecisions={content.sourceDecisions}
              value={content.policy.orderingAuthority}
              onChange={updateOrderingAuthorityRequest}
            />
            <StageParticipantSourceCoverageNotice
              stages={policy.stages}
              definitions={content.policy.stageParticipantSources ?? []}
              orderingAuthority={orderingAuthorityRequest}
              orderingAuthorityAvailable={orderingAuthorityAvailable}
            />
          </>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            Add policy language before recording a governing comparator request or a participant
            source. Existing stages remain unchanged.
          </p>
        )}
        {people.isError && (
          <p role="alert">
            The member catalog could not be loaded. Existing participant references are retained.
          </p>
        )}
        {[...policy.stages]
          .sort((a, b) => a.order - b.order)
          .map((stage, index, ordered) => {
            const updateStage = (patch: Partial<typeof stage>) =>
              updatePolicy({
                ...policy,
                stages: policy.stages.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)),
              });
            const move = (offset: number) => {
              const next = [...ordered];
              next.splice(index + offset, 0, ...next.splice(index, 1));
              updatePolicy({
                ...policy,
                stages: next.map((s, i) => ({ ...s, order: i })),
                ...(ops ? { annualOperations: { ...ops, stageOrder: next.map((s) => s.id) } } : {}),
              });
            };
            return (
              <details key={stage.id} className="rounded border border-border p-4">
                <summary className="min-h-11 content-center cursor-pointer font-medium">
                  {index + 1}. {stage.label || 'Stage name required'} · {stage.memberIds.length}{' '}
                  participants · {stage.opportunityPositionIds.length} opportunities
                </summary>
                <div className="mt-4 space-y-4">
                  <TextField
                    label="Stage name"
                    value={stage.label}
                    onChange={(label) => updateStage({ label })}
                  />
                  <ChoiceField
                    label="Stage category"
                    value={stage.kind}
                    options={(
                      ['D_SHIFT', 'CAPTAIN', 'LIEUTENANT', 'FIREFIGHTER', 'MIXED'] as const
                    ).map((value) => ({ value, label: value.replaceAll('_', ' ') }))}
                    onChange={(kind) => updateStage({ kind })}
                  />
                  <ReferencePicker
                    label={
                      content.policy?.stageParticipantSources?.some(
                        (definition) => definition.stageId === stage.id,
                      )
                        ? `Legacy explicit participant references in ${stage.label || stage.id}`
                        : `Participants in ${stage.label || stage.id}`
                    }
                    values={stage.memberIds.map(String)}
                    options={people.data ?? []}
                    onChange={(members) => updateStage({ memberIds: members.map(Number) })}
                    help={
                      content.policy?.stageParticipantSources?.some(
                        (definition) => definition.stageId === stage.id,
                      )
                        ? 'Retained legacy compatibility data only. It is not this stage’s authored selector roster and this browser does not resolve or synchronize selector membership.'
                        : 'The current frozen execution schema retains these explicit references separately. A selector-only new stage cannot become execution-ready here; do not enter placeholders.'
                    }
                  />
                  <ReferencePicker
                    label={`Opportunities in ${stage.label || stage.id}`}
                    values={stage.opportunityPositionIds}
                    options={opportunities}
                    onChange={(opportunityPositionIds) => updateStage({ opportunityPositionIds })}
                  />
                  {content.policy && (
                    <StageParticipantSourceEditor
                      stageId={stage.id}
                      savedDefinition={content.policy.stageParticipantSources?.find(
                        (definition) => definition.stageId === stage.id,
                      )}
                      orderingAuthority={orderingAuthorityRequest}
                      orderingAuthorityAvailable={orderingAuthorityAvailable}
                      executionStageReady={stage.memberIds.length > 0}
                      onSave={saveStageParticipantSource}
                      onRemove={() => removeStageParticipantSource(stage.id)}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={index === 0} onClick={() => move(-1)}>
                      Move stage earlier
                    </Button>
                    <Button
                      type="button"
                      disabled={index === ordered.length - 1}
                      onClick={() => move(1)}
                    >
                      Move stage later
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        const next = {
                          ...policy,
                          stages: policy.stages.filter((s) => s.id !== stage.id),
                          ...(ops
                            ? {
                                annualOperations: {
                                  ...ops,
                                  stageOrder: ops.stageOrder.filter((id) => id !== stage.id),
                                },
                              }
                            : {}),
                        };
                        updatePolicy(
                          next,
                          content.policy
                            ? withoutStageParticipantSource(content.policy, stage.id)
                            : null,
                        );
                      }}
                    >
                      Remove stage from draft
                    </Button>
                  </div>
                </div>
              </details>
            );
          })}
        <Button
          type="button"
          onClick={() => {
            const id = crypto.randomUUID();
            updatePolicy({
              ...policy,
              stages: [
                ...policy.stages,
                {
                  id,
                  label: '',
                  order: Math.max(-1, ...policy.stages.map((s) => s.order)) + 1,
                  kind: 'MIXED',
                  memberIds: [],
                  opportunityPositionIds: [],
                },
              ],
              ...(ops ? { annualOperations: { ...ops, stageOrder: [...ops.stageOrder, id] } } : {}),
            });
          }}
        >
          Add stage
        </Button>
      </FieldSection>
    );
  if (section === 'authority')
    return (
      <FieldSection
        title="Authority & permissions"
        description="Grant each action to named members. Administrative access alone does not grant Live Bid authority."
      >
        {policy.actionPermissions.map((grant, index) => (
          <ReferencePicker
            key={grant.action}
            label={grant.action.replaceAll('_', ' ')}
            values={grant.actorMemberIds.map(String)}
            options={people.data ?? []}
            onChange={(members) =>
              updatePolicy({
                ...policy,
                actionPermissions: policy.actionPermissions.map((g, i) =>
                  i === index ? { ...g, actorMemberIds: members.map(Number) } : g,
                ),
              })
            }
          />
        ))}
        {(['transitionPolicyReference', 'publicationPolicyReference'] as const).map((key) => (
          <NullableText
            key={key}
            label={
              key === 'transitionPolicyReference'
                ? 'Assignment transition authority'
                : 'Publication authority'
            }
            value={policy[key]}
            onChange={(value) => updatePolicy({ ...policy, [key]: value })}
          />
        ))}
      </FieldSection>
    );
  if (section === 'contact')
    return (
      <div className="space-y-4">
        <FieldSection title="Contact procedure">
          {ops ? (
            <>
              <NumberField
                label="Minimum contact attempts"
                min={0}
                max={10}
                value={ops.contact.minimumAttempts}
                onChange={(minimumAttempts) =>
                  changeOps({ ...ops, contact: { ...ops.contact, minimumAttempts } })
                }
              />
              <ChoiceField
                label="Contact timing"
                value={ops.contact.timingMode}
                options={[
                  { value: 'HARD_MINIMUM', label: 'Required minimum' },
                  { value: 'TARGET', label: 'Target duration' },
                  { value: 'OPERATOR_DISCRETION', label: 'Operator discretion' },
                ]}
                onChange={(timingMode) =>
                  changeOps({ ...ops, contact: { ...ops.contact, timingMode } })
                }
              />
              <CheckField
                label="Specify a contact duration"
                value={ops.contact.durationSeconds !== null}
                onChange={(enabled) =>
                  changeOps({
                    ...ops,
                    contact: { ...ops.contact, durationSeconds: enabled ? 0 : null },
                  })
                }
              />
              {ops.contact.durationSeconds !== null && (
                <NumberField
                  label="Contact duration (seconds)"
                  max={86400}
                  value={ops.contact.durationSeconds}
                  onChange={(durationSeconds) =>
                    changeOps({ ...ops, contact: { ...ops.contact, durationSeconds } })
                  }
                />
              )}
              <CheckField
                label="Require contact evidence"
                value={ops.contact.evidenceRequired === true}
                onChange={(evidenceRequired) =>
                  changeOps({ ...ops, contact: { ...ops.contact, evidenceRequired } })
                }
              />
            </>
          ) : (
            <p>Contact procedure has not been configured.</p>
          )}
        </FieldSection>
        <FieldSection title="Pass, defer & disposition">
          {policy.dispositions.map((rule, index) => {
            const update = (patch: Partial<typeof rule>) =>
              updatePolicy({
                ...policy,
                dispositions: policy.dispositions.map((r, i) =>
                  i === index ? { ...r, ...patch } : r,
                ),
              });
            return (
              <details key={rule.disposition} className="rounded border border-border p-3">
                <summary className="min-h-11 content-center cursor-pointer font-medium">
                  {rule.disposition}
                </summary>
                <div className="space-y-3">
                  {(
                    [
                      'advances',
                      'retainsLaterSelectionRights',
                      'terminal',
                      'requiresReason',
                      'requiresEvidence',
                    ] as const
                  ).map((key) => (
                    <CheckField
                      key={key}
                      label={
                        {
                          advances: 'Advance to the next participant',
                          retainsLaterSelectionRights: 'Retain later selection rights',
                          terminal: 'End participation',
                          requiresReason: 'Require a reason',
                          requiresEvidence: 'Require evidence',
                        }[key]
                      }
                      value={rule[key]}
                      onChange={(value) => update({ [key]: value })}
                    />
                  ))}
                  <ChoiceField
                    label="Return stage"
                    value={rule.returnStageId ?? ''}
                    options={[
                      { value: '', label: 'Does not return' },
                      ...policy.stages.map((s) => ({ value: s.id, label: s.label || s.id })),
                      ...(rule.returnStageId &&
                      !policy.stages.some((s) => s.id === rule.returnStageId)
                        ? [
                            {
                              value: rule.returnStageId,
                              label: `${rule.returnStageId} · Missing stage`,
                            },
                          ]
                        : []),
                    ]}
                    onChange={(id) => update({ returns: id !== '', returnStageId: id || null })}
                  />
                  <NullableText
                    label="Contact authority"
                    value={rule.contactPolicyReference}
                    onChange={(contactPolicyReference) => update({ contactPolicyReference })}
                  />
                </div>
              </details>
            );
          })}
        </FieldSection>
      </div>
    );
  if (section === 'a-day')
    return (
      <FieldSection
        title="A-Day"
        description="Capacity limits are part of this Bid version. The existing A-Day engine validates assignments during execution."
      >
        <NullableText
          label="A-Day policy reference"
          value={policy.aDayPolicyReference}
          onChange={(aDayPolicyReference) => updatePolicy({ ...policy, aDayPolicyReference })}
        />
        {ops ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <BidADayExecutionFields
              value={ops.aDay.execution}
              opportunities={opportunities}
              profiles={(content.authoring?.profiles ?? []).map((profile) => ({
                value: profile.id,
                label: `${profile.name} · ${profile.scope.kind} profile`,
              }))}
              members={people.data ?? []}
              onChange={(execution) => {
                const { execution: _previous, ...capacity } = ops.aDay;
                changeOps({ ...ops, aDay: execution ? { ...capacity, execution } : capacity });
              }}
            />
            <NumberField
              label="Minimum group size"
              value={ops.aDay.min}
              max={1000}
              onChange={(min) => changeOps({ ...ops, aDay: { ...ops.aDay, min } })}
            />
            <NumberField
              label="Maximum group size"
              value={ops.aDay.max}
              max={1000}
              onChange={(max) => changeOps({ ...ops, aDay: { ...ops.aDay, max } })}
            />
            <NumberField
              label="Captain / Division Chief maximum"
              value={ops.aDay.captainDcMax}
              max={1000}
              onChange={(captainDcMax) =>
                changeOps({ ...ops, aDay: { ...ops.aDay, captainDcMax } })
              }
            />
            {(
              Object.keys(ops.aDay.specialtyMaximums) as (keyof typeof ops.aDay.specialtyMaximums)[]
            ).map((key) => (
              <NumberField
                key={key}
                label={`${key.replaceAll('_', ' ')} maximum`}
                value={ops.aDay.specialtyMaximums[key]}
                max={1000}
                onChange={(value) =>
                  changeOps({
                    ...ops,
                    aDay: {
                      ...ops.aDay,
                      specialtyMaximums: { ...ops.aDay.specialtyMaximums, [key]: value },
                    },
                  })
                }
              />
            ))}
          </div>
        ) : (
          <p>A-Day capacity has not been configured.</p>
        )}
      </FieldSection>
    );
  return (
    <FieldSection title="Specialty rules">
      <NullableText
        label="Specialty policy reference"
        value={policy.specialtyCatalogReference}
        onChange={(specialtyCatalogReference) =>
          updatePolicy({ ...policy, specialtyCatalogReference })
        }
      />
      {ops ? (
        <>
          <BidFallbackFields
            value={ops.fallbackPolicies}
            opportunities={opportunities}
            sourceDecisions={content.sourceDecisions}
            onChange={(fallbackPolicies) => {
              const { fallbackPolicies: _previous, ...remaining } = ops;
              changeOps(
                fallbackPolicies === undefined ? remaining : { ...remaining, fallbackPolicies },
              );
            }}
          />
          <BidOpportunityPoolFields
            value={ops.opportunityPools}
            opportunities={opportunities}
            sourceDecisions={content.sourceDecisions}
            onChange={(opportunityPools) => {
              const { opportunityPools: _previous, ...remaining } = ops;
              changeOps(
                opportunityPools === undefined ? remaining : { ...remaining, opportunityPools },
              );
            }}
          />
          <BidMembershipFields
            value={ops.membershipDistributions}
            members={people.data ?? []}
            onChange={(membershipDistributions) => {
              const { membershipDistributions: _previous, ...remaining } = ops;
              changeOps(
                membershipDistributions === undefined
                  ? remaining
                  : { ...remaining, membershipDistributions },
              );
            }}
          />
          <BidAssignmentTermFields
            value={ops.assignmentTerms}
            opportunities={opportunities}
            onChange={(assignmentTerms) => {
              const { assignmentTerms: _previous, ...remaining } = ops;
              changeOps(
                assignmentTerms === undefined ? remaining : { ...remaining, assignmentTerms },
              );
            }}
          />
          <ReferencePicker
            label="Required specialty opportunities"
            values={ops.requiredTopologyPositionIds}
            options={opportunities}
            onChange={(requiredTopologyPositionIds) =>
              changeOps({ ...ops, requiredTopologyPositionIds })
            }
          />
          {(ops.specialties ?? []).map((specialty, index) => {
            const update = (patch: Partial<typeof specialty>) =>
              changeOps({
                ...ops,
                specialties: ops.specialties?.map((s, i) => (i === index ? { ...s, ...patch } : s)),
              });
            return (
              <details key={specialty.id} className="rounded border border-border p-4">
                <summary className="min-h-11 content-center cursor-pointer font-medium">
                  {specialty.label || specialty.id}
                </summary>
                <div className="space-y-4">
                  <TextField
                    label="Specialty name"
                    value={specialty.label}
                    onChange={(label) => update({ label })}
                  />
                  <ChoiceField
                    label="Specialty behavior"
                    value={specialty.mode}
                    options={[
                      { value: 'INTERRUPTING', label: 'Interrupt ordinary bidding' },
                      { value: 'PRIORITY_ONLY', label: 'Priority without interruption' },
                    ]}
                    onChange={(mode) => update({ mode })}
                  />
                  <ReferencePicker
                    label="Specialty opportunities"
                    values={specialty.opportunityPositionIds}
                    options={opportunities}
                    onChange={(opportunityPositionIds) => update({ opportunityPositionIds })}
                  />
                  <ReferencePicker
                    label="Specialty qualifications"
                    values={specialty.requiredCredentialNames}
                    options={(credentials.data ?? []).map((c) => ({
                      value: c.policyName ?? c.name,
                      label: c.name,
                    }))}
                    onChange={(requiredCredentialNames) => update({ requiredCredentialNames })}
                  />
                  <TextEntries
                    label="Required specialty evidence"
                    values={specialty.requiredSpecialtyCodes}
                    onChange={(requiredSpecialtyCodes) => update({ requiredSpecialtyCodes })}
                    help="Use the approved specialty qualification codes recorded with member evidence. Every listed specialty qualification is required."
                  />
                  {specialty.scoring ? (
                    <>
                      <ConfiguredScoringEditor
                        value={specialty.scoring}
                        onChange={(scoring) => update({ scoring })}
                      />
                      <ChoiceField
                        label="Ranking points"
                        value={specialty.rankingChannel ?? 'total'}
                        options={[
                          { value: 'total', label: 'Total' },
                          { value: 'so', label: 'Special Operations' },
                          { value: 'mo', label: 'Marine Operations' },
                        ]}
                        onChange={(rankingChannel) => update({ rankingChannel })}
                      />
                      <details className="rounded border border-border p-3">
                        <summary className="min-h-11 content-center cursor-pointer">
                          Review return to flat specialty scoring
                        </summary>
                        <p className="my-3 text-sm">
                          Remove every configured scoring group and its ranking channel from this
                          draft. The specialty, requirements and tie break order are retained. Enter
                          the approved flat point awards after removing the groups.
                        </p>
                        <Button
                          type="button"
                          onClick={() =>
                            changeOps({
                              ...ops,
                              specialties: ops.specialties?.map((s, i) => {
                                if (i !== index) return s;
                                const { scoring: _scoring, rankingChannel: _channel, ...flat } = s;
                                return flat;
                              }),
                            })
                          }
                        >
                          Remove grouped specialty scoring
                        </Button>
                      </details>
                    </>
                  ) : (
                    <>
                      {specialty.points.map((point, pointIndex) => (
                        <fieldset
                          key={`specialty-points-${pointIndex + 1}`}
                          className="space-y-3 rounded border border-border p-3"
                        >
                          <legend className="px-1">Specialty point award {pointIndex + 1}</legend>
                          <ChoiceField
                            label="Scored qualification"
                            value={point.credentialName}
                            options={[
                              { value: '', label: 'Choose qualification' },
                              ...(credentials.data ?? []).map((c) => ({
                                value: c.policyName ?? c.name,
                                label: c.name,
                              })),
                              ...(point.credentialName &&
                              !credentials.data?.some(
                                (c) => (c.policyName ?? c.name) === point.credentialName,
                              )
                                ? [
                                    {
                                      value: point.credentialName,
                                      label: `${point.credentialName} · Saved qualification`,
                                    },
                                  ]
                                : []),
                            ]}
                            onChange={(credentialName) =>
                              update({
                                points: specialty.points.map((p, i) =>
                                  i === pointIndex ? { ...p, credentialName } : p,
                                ),
                              })
                            }
                          />
                          <NumberField
                            label="Specialty points"
                            value={point.value}
                            max={10000}
                            onChange={(value) =>
                              update({
                                points: specialty.points.map((p, i) =>
                                  i === pointIndex ? { ...p, value } : p,
                                ),
                              })
                            }
                          />
                          <Button
                            type="button"
                            onClick={() =>
                              update({
                                points: specialty.points.filter((_, i) => i !== pointIndex),
                              })
                            }
                          >
                            Remove specialty point award {pointIndex + 1}
                          </Button>
                        </fieldset>
                      ))}
                      <Button
                        type="button"
                        disabled={specialty.points.length >= 100}
                        onClick={() =>
                          update({
                            points: [...specialty.points, { credentialName: '', value: 0 }],
                          })
                        }
                      >
                        Add specialty point award
                      </Button>
                      {!specialty.points.length && (
                        <Button
                          type="button"
                          onClick={() =>
                            update({
                              scoring: { v: 1, total: [], so: [], mo: [] },
                              rankingChannel: 'total',
                            })
                          }
                        >
                          Configure specialty grouped scoring
                        </Button>
                      )}
                    </>
                  )}
                  <OrderedChoices
                    label="Specialty tie break"
                    values={specialty.tieBreakChain}
                    options={(
                      [
                        'POINTS',
                        'RSC_SENIORITY',
                        'RANK_SENIORITY',
                        'TIME_IN_GRADE_BID_ORDINAL',
                        'DEPARTMENT_SERVICE_BID_ORDINAL',
                      ] as const
                    ).map((value) => ({ value, label: value.replaceAll('_', ' ') }))}
                    onChange={(tieBreakChain) => update({ tieBreakChain })}
                  />
                  <Button
                    type="button"
                    onClick={() =>
                      changeOps({
                        ...ops,
                        specialties: ops.specialties?.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove specialty from draft
                  </Button>
                </div>
              </details>
            );
          })}
          <Button
            type="button"
            onClick={() =>
              changeOps({
                ...ops,
                specialties: [
                  ...(ops.specialties ?? []),
                  {
                    id: crypto.randomUUID(),
                    label: '',
                    mode: 'PRIORITY_ONLY',
                    opportunityPositionIds: [],
                    requiredCredentialNames: [],
                    requiredSpecialtyCodes: [],
                    points: [],
                    tieBreakChain: [],
                  },
                ],
              })
            }
          >
            Add specialty
          </Button>
        </>
      ) : (
        <p>Specialty operations have not been configured.</p>
      )}
    </FieldSection>
  );
}
