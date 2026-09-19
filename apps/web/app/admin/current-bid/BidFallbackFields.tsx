'use client';

import { PostAwardObligationsEditor } from '@/components/admin/PostAwardObligationsEditor';
import { QualificationAlternativesEditor } from '@/components/admin/QualificationAlternativesEditor';
import { ServiceRequirementsEditor } from '@/components/admin/ServiceRequirementsEditor';
import { Button } from '@/components/ui/button';
import { useCredentialCatalog } from '@/lib/use-credential-catalog';
import {
  type BidDefinitionContent,
  type FrozenLiveBidPolicy,
  type PostAwardObligation,
  RULE_CUSTOM_CRITERIA,
  RULE_RANKS,
} from '@mbfd/shared';
import {
  CheckField,
  ChoiceField,
  FieldSection,
  type ReferenceOption,
  ReferencePicker,
  TextField,
} from './BidFields';

type Policies = NonNullable<FrozenLiveBidPolicy['annualOperations']>['fallbackPolicies'];
type Policy = NonNullable<Policies>[number];
type Tier = Policy['tiers'][number];
type Requirements = Extract<Tier['eligibility'], { kind: 'EXPLICIT_REQUIREMENTS' }>['requirements'];
const comparatorOptions = [
  { value: 'RSC_SENIORITY', label: 'RSC seniority' },
  { value: 'RANK_SENIORITY', label: 'Rank seniority' },
  { value: 'TIME_IN_GRADE_BID_ORDINAL', label: 'Time-in-grade Bid ordinal' },
  { value: 'DEPARTMENT_SERVICE_BID_ORDINAL', label: 'Department-service Bid ordinal' },
] as const;

function FallbackRequirements({
  value,
  onChange,
}: { value: Requirements; onChange(value: Requirements): void }) {
  const catalog = useCredentialCatalog();
  const patch = (next: Partial<Requirements>) => onChange({ ...value, ...next });
  return (
    <FieldSection
      title="Fallback eligibility requirements"
      description="These requirements apply only to this fallback tier. They do not change the opportunity's ordinary minimum requirements."
    >
      {catalog.isError && (
        <p role="alert">Qualification catalog unavailable. Saved selections remain visible.</p>
      )}
      <ReferencePicker
        label="Eligible ranks"
        values={value.ranks ?? []}
        options={RULE_RANKS.map((rank) => ({ value: rank, label: rank }))}
        onChange={(ranks) => {
          if (ranks.length) patch({ ranks: ranks as NonNullable<Requirements['ranks']> });
          else {
            const { ranks: _ranks, ...remaining } = value;
            onChange(remaining);
          }
        }}
      />
      <ReferencePicker
        label="Required qualifications"
        values={value.credentials}
        options={(catalog.data ?? []).map((entry) => ({
          value: entry.policyName ?? entry.name,
          label: entry.name,
        }))}
        onChange={(credentials) => patch({ credentials })}
      />
      <QualificationAlternativesEditor
        value={value.anyOfCredentials ?? []}
        onChange={(anyOfCredentials) => patch({ anyOfCredentials })}
      />
      <ServiceRequirementsEditor
        value={value.service ?? []}
        onChange={(service) => patch({ service })}
      />
      <PostAwardObligationsEditor
        value={(value.postAward ?? []) as PostAwardObligation[]}
        onChange={(postAward) => patch({ postAward })}
      />
      <ReferencePicker
        label="Additional requirements"
        values={value.custom}
        options={RULE_CUSTOM_CRITERIA.map((custom) => ({
          value: custom,
          label: custom.replaceAll('_', ' '),
        }))}
        onChange={(custom) => patch({ custom: custom as Requirements['custom'] })}
      />
    </FieldSection>
  );
}

function move<T>(values: T[], index: number, offset: number): T[] {
  const next = [...values];
  const removed = next.splice(index, 1);
  next.splice(index + offset, 0, ...removed);
  return next;
}

export function BidFallbackFields({
  value,
  opportunities,
  sourceDecisions,
  onChange,
}: {
  value: Policies;
  opportunities: ReferenceOption[];
  sourceDecisions: BidDefinitionContent['sourceDecisions'];
  onChange(value: Policies): void;
}) {
  return (
    <FieldSection
      title="Fallback assignment policies"
      description="Define the ordered steps used when ordinary bidding leaves an opportunity unfilled. Each policy needs an explicit opportunity scope and source decision."
    >
      <CheckField
        label="Configure fallback assignment policies"
        value={value !== undefined}
        onChange={(enabled) => onChange(enabled ? [] : undefined)}
      />
      {value === undefined ? (
        <p className="text-sm text-muted-foreground">
          This saved Bid has no explicit fallback configuration.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Only the fallback policies listed here are permitted. An empty list permits no fallback
            assignments. Selecting a source decision does not resolve or approve it.
          </p>
          {value.map((policy, policyIndex) => {
            const patch = (update: Partial<Policy>) =>
              onChange(
                value.map((entry, index) =>
                  index === policyIndex ? { ...entry, ...update } : entry,
                ),
              );
            const selectedDecision = sourceDecisions.find(
              (decision) => decision.issueId === policy.sourceDecisionId,
            );
            return (
              <fieldset key={policy.id} className="space-y-4 rounded border border-border p-4">
                <legend className="px-1 font-medium">Fallback policy {policyIndex + 1}</legend>
                <TextField
                  label="Fallback policy name"
                  value={policy.label}
                  onChange={(label) => patch({ label })}
                />
                <TextField
                  label="Fallback policy source"
                  value={policy.sourceRef}
                  onChange={(sourceRef) => patch({ sourceRef })}
                />
                <ChoiceField
                  label="Fallback source decision"
                  value={policy.sourceDecisionId}
                  options={[
                    { value: '', label: 'Choose a saved source decision' },
                    ...sourceDecisions.map((decision) => ({
                      value: decision.issueId,
                      label: `${decision.title || decision.issueId} · ${decision.status}`,
                    })),
                    ...(policy.sourceDecisionId && !selectedDecision
                      ? [
                          {
                            value: policy.sourceDecisionId,
                            label: `${policy.sourceDecisionId} · Saved decision missing; review required`,
                          },
                        ]
                      : []),
                  ]}
                  onChange={(sourceDecisionId) => patch({ sourceDecisionId })}
                />
                <ReferencePicker
                  label="Fallback opportunities"
                  values={policy.positionIds}
                  options={opportunities}
                  onChange={(positionIds) => patch({ positionIds })}
                />
                {policy.tiers.map((tier, tierIndex) => {
                  const update = (change: Partial<Tier>) =>
                    patch({
                      tiers: policy.tiers.map((entry, index) =>
                        index === tierIndex ? { ...entry, ...change } : entry,
                      ),
                    });
                  return (
                    <fieldset key={tier.id} className="space-y-4 rounded border border-border p-4">
                      <legend className="px-1 font-medium">Fallback tier {tierIndex + 1}</legend>
                      <TextField
                        label="Tier name"
                        value={tier.label}
                        onChange={(label) => update({ label })}
                      />
                      <ChoiceField
                        label="Assignment method"
                        value={tier.mode}
                        options={[
                          { value: 'VOLUNTARY', label: 'Offer voluntarily' },
                          { value: 'FORCED', label: 'Assign by force' },
                        ]}
                        onChange={(mode) => update({ mode })}
                      />
                      <ChoiceField
                        label="Tier eligibility"
                        value={tier.eligibility.kind}
                        options={[
                          {
                            value: 'MINIMUM_QUALIFIED',
                            label: 'Must meet the opportunity minimums',
                          },
                          {
                            value: 'EXPLICIT_REQUIREMENTS',
                            label: 'Use separately approved fallback requirements',
                          },
                        ]}
                        onChange={(kind) =>
                          update({
                            eligibility:
                              kind === 'MINIMUM_QUALIFIED'
                                ? { kind }
                                : { kind, requirements: { credentials: [], custom: [] } },
                          })
                        }
                      />
                      {tier.eligibility.kind === 'EXPLICIT_REQUIREMENTS' && (
                        <FallbackRequirements
                          value={tier.eligibility.requirements}
                          onChange={(requirements) =>
                            update({ eligibility: { kind: 'EXPLICIT_REQUIREMENTS', requirements } })
                          }
                        />
                      )}
                      <CheckField
                        label="Limit this tier to currently assigned personnel"
                        value={tier.currentlyAssignedOnly}
                        onChange={(currentlyAssignedOnly) => update({ currentlyAssignedOnly })}
                      />
                      <CheckField
                        label="Require no completed full Days Bid tour"
                        value={tier.historyPredicate !== undefined}
                        onChange={(enabled) => {
                          const { historyPredicate: _old, ...rest } = tier;
                          patch({
                            tiers: policy.tiers.map((entry, index) =>
                              index === tierIndex
                                ? enabled
                                  ? {
                                      ...tier,
                                      historyPredicate: {
                                        kind: 'NO_COMPLETED_DAYS_BID_TOUR',
                                        sourceRef: policy.sourceRef,
                                      },
                                    }
                                  : rest
                                : entry,
                            ),
                          });
                        }}
                      />
                      <p className="text-sm text-muted-foreground">
                        Candidates are compared in the order below. Enter the direction approved by
                        the source decision.
                      </p>
                      {tier.comparator.map((comparator, comparatorIndex) => (
                        <fieldset
                          key={`${tier.id}-comparator-${comparatorIndex + 1}`}
                          className="space-y-2 rounded border border-border p-3"
                        >
                          <legend className="px-1">Comparison {comparatorIndex + 1}</legend>
                          <ChoiceField
                            label="Seniority measure"
                            value={comparator.key}
                            options={comparatorOptions.filter(
                              (option) =>
                                option.value === comparator.key ||
                                !tier.comparator.some((entry) => entry.key === option.value),
                            )}
                            onChange={(key) =>
                              update({
                                comparator: tier.comparator.map((entry, index) =>
                                  index === comparatorIndex ? { ...entry, key } : entry,
                                ),
                              })
                            }
                          />
                          <ChoiceField
                            label="Comparison direction"
                            value={comparator.direction}
                            options={[
                              { value: 'ASC', label: 'Lower values first' },
                              { value: 'DESC', label: 'Higher values first' },
                            ]}
                            onChange={(direction) =>
                              update({
                                comparator: tier.comparator.map((entry, index) =>
                                  index === comparatorIndex ? { ...entry, direction } : entry,
                                ),
                              })
                            }
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              disabled={comparatorIndex === 0}
                              onClick={() =>
                                update({ comparator: move(tier.comparator, comparatorIndex, -1) })
                              }
                            >
                              Move comparison up
                            </Button>
                            <Button
                              type="button"
                              disabled={comparatorIndex === tier.comparator.length - 1}
                              onClick={() =>
                                update({ comparator: move(tier.comparator, comparatorIndex, 1) })
                              }
                            >
                              Move comparison down
                            </Button>
                            <Button
                              type="button"
                              onClick={() =>
                                update({
                                  comparator: tier.comparator.filter(
                                    (_, index) => index !== comparatorIndex,
                                  ),
                                })
                              }
                            >
                              Remove comparison
                            </Button>
                          </div>
                        </fieldset>
                      ))}
                      <Button
                        type="button"
                        disabled={tier.comparator.length >= 2}
                        onClick={() => {
                          const next = comparatorOptions.find(
                            (option) =>
                              !tier.comparator.some((entry) => entry.key === option.value),
                          );
                          if (next)
                            update({
                              comparator: [
                                ...tier.comparator,
                                { key: next.value, direction: 'ASC' },
                              ],
                            });
                        }}
                      >
                        Add seniority comparison
                      </Button>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={tierIndex === 0}
                          onClick={() => patch({ tiers: move(policy.tiers, tierIndex, -1) })}
                        >
                          Move tier up
                        </Button>
                        <Button
                          type="button"
                          disabled={tierIndex === policy.tiers.length - 1}
                          onClick={() => patch({ tiers: move(policy.tiers, tierIndex, 1) })}
                        >
                          Move tier down
                        </Button>
                        <Button
                          type="button"
                          onClick={() =>
                            patch({ tiers: policy.tiers.filter((_, index) => index !== tierIndex) })
                          }
                        >
                          Remove tier
                        </Button>
                      </div>
                    </fieldset>
                  );
                })}
                <Button
                  type="button"
                  disabled={policy.tiers.length >= 10}
                  onClick={() =>
                    patch({
                      tiers: [
                        ...policy.tiers,
                        {
                          id: crypto.randomUUID(),
                          label: '',
                          mode: 'VOLUNTARY',
                          eligibility: { kind: 'MINIMUM_QUALIFIED' },
                          currentlyAssignedOnly: false,
                          comparator: [],
                        },
                      ],
                    })
                  }
                >
                  Add fallback tier
                </Button>
                <Button
                  type="button"
                  onClick={() => onChange(value.filter((_, index) => index !== policyIndex))}
                >
                  Remove fallback policy {policyIndex + 1}
                </Button>
              </fieldset>
            );
          })}
          <Button
            type="button"
            disabled={value.length >= 100}
            onClick={() =>
              onChange([
                ...value,
                {
                  id: crypto.randomUUID(),
                  label: '',
                  sourceRef: '',
                  sourceDecisionId: '',
                  positionIds: [],
                  tiers: [],
                },
              ])
            }
          >
            Add fallback policy
          </Button>
        </>
      )}
    </FieldSection>
  );
}
