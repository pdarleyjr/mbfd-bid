'use client';

import { Button } from '@/components/ui/button';
import type { BidDefinitionContent, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import {
  CheckField,
  ChoiceField,
  FieldSection,
  OrderedChoices,
  type ReferenceOption,
  TextField,
} from './BidFields';

type Pools = FrozenAnnualOperationsPolicy['opportunityPools'];
export function BidOpportunityPoolFields({
  value,
  opportunities,
  sourceDecisions,
  onChange,
}: {
  value: Pools;
  opportunities: ReferenceOption[];
  sourceDecisions: BidDefinitionContent['sourceDecisions'];
  onChange(value: Pools): void;
}) {
  const sources = sourceDecisions
    .filter((source) => source.area === 'annual-policy')
    .map((source) => ({
      value: source.issueId,
      label: `${source.title || source.issueId} · ${source.status}`,
    }));
  return (
    <FieldSection
      title="Station and float pools"
      description="A pool offers interchangeable capacity slots as one choice. Select reviewed slots explicitly; station and apparatus names do not create pools. Daily apparatus placement remains separate."
    >
      <CheckField
        label="Configure opportunity pools"
        value={value !== undefined}
        onChange={(enabled) => onChange(enabled ? [] : undefined)}
      />
      {value?.map((pool, index) => {
        const patch = (change: Partial<typeof pool>) =>
          onChange(value.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
        const options = [
          ...opportunities,
          ...pool.positionIds
            .filter((id) => !opportunities.some((option) => option.value === id))
            .map((id) => ({ value: id, label: `${id} · Saved slot; catalog review required` })),
        ];
        const sourceOptions = [
          ...sources,
          ...(pool.sourceDecisionId &&
          !sources.some((source) => source.value === pool.sourceDecisionId)
            ? [
                {
                  value: pool.sourceDecisionId,
                  label: `${pool.sourceDecisionId} · Saved decision; source review required`,
                },
              ]
            : []),
        ];
        return (
          <fieldset key={pool.id} className="space-y-4 rounded border border-border p-4">
            <legend>Opportunity pool {index + 1}</legend>
            <TextField
              label="Pool name"
              value={pool.label}
              onChange={(label) => patch({ label })}
            />
            <ChoiceField
              label="Pool kind"
              value={pool.kind}
              options={[
                { value: 'STATION_POOL', label: 'Station pool' },
                { value: 'FLOAT_POOL', label: 'Float pool' },
              ]}
              onChange={(kind) => patch({ kind })}
            />
            <TextField
              label="Pool source clause"
              value={pool.sourceRef}
              onChange={(sourceRef) => patch({ sourceRef })}
            />
            <ChoiceField
              label="Pool source decision"
              value={pool.sourceDecisionId}
              options={[
                { value: '', label: 'Select an annual policy source decision' },
                ...sourceOptions,
              ]}
              onChange={(sourceDecisionId) => patch({ sourceDecisionId })}
            />
            <p className="text-sm text-muted-foreground">
              The first available slot in this order is reserved when the pool is selected. Every
              slot must have matching eligibility, ranking, shift and policy scopes. Review shared
              rules before saving. Unresolved source decisions block execution.
            </p>
            <OrderedChoices
              label="Capacity slot"
              values={pool.positionIds}
              options={options}
              onChange={(positionIds) => patch({ positionIds })}
            />
            <Button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              Remove opportunity pool {index + 1}
            </Button>
          </fieldset>
        );
      })}
      {value !== undefined && (
        <Button
          type="button"
          disabled={value.length >= 100}
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                label: '',
                kind: 'STATION_POOL',
                sourceRef: '',
                sourceDecisionId: '',
                positionIds: [],
              },
            ])
          }
        >
          Add opportunity pool
        </Button>
      )}
    </FieldSection>
  );
}
