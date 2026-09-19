'use client';

import { Button } from '@/components/ui/button';
import type { FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import {
  CheckField,
  FieldSection,
  NumberField,
  type ReferenceOption,
  ReferencePicker,
  TextField,
} from './BidFields';

type Distributions = FrozenAnnualOperationsPolicy['membershipDistributions'];
export function BidMembershipFields({
  value,
  members,
  onChange,
}: {
  value: Distributions;
  members: ReferenceOption[];
  onChange(value: Distributions): void;
}) {
  return (
    <FieldSection
      title="Specialty membership distribution"
      description="Reviewed existing memberships stay with the member while their station and shift assignment changes. They do not consume another position."
    >
      <CheckField
        label="Configure existing membership distribution"
        value={value !== undefined}
        onChange={(enabled) => onChange(enabled ? [] : undefined)}
      />
      {value?.map((distribution, index) => {
        const patch = (change: Partial<typeof distribution>) =>
          onChange(value.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
        return (
          <fieldset key={distribution.id} className="space-y-4 rounded border p-4">
            <legend>Membership distribution {index + 1}</legend>
            <TextField
              label="Membership name"
              value={distribution.label}
              onChange={(label) => patch({ label })}
            />
            <TextField
              label="Membership source"
              value={distribution.sourceRef}
              onChange={(sourceRef) => patch({ sourceRef })}
            />
            <TextField
              label="Membership source decision"
              value={distribution.sourceDecisionId}
              onChange={(sourceDecisionId) => patch({ sourceDecisionId })}
            />
            <ReferencePicker
              label="Reviewed existing members"
              values={distribution.memberIds.map(String)}
              options={members}
              onChange={(ids) => patch({ memberIds: ids.map(Number) })}
            />
            <ReferencePicker
              label="Membership shifts"
              values={distribution.shifts}
              options={['A', 'B', 'C'].map((shift) => ({ value: shift, label: shift }))}
              onChange={(shifts) => patch({ shifts: shifts as typeof distribution.shifts })}
            />
            <NumberField
              label="Minimum members per shift"
              min={0}
              max={1000}
              value={distribution.minimumPerShift}
              onChange={(minimumPerShift) => patch({ minimumPerShift })}
            />
            <NumberField
              label="Maximum members per shift"
              min={1}
              max={1000}
              value={distribution.maximumPerShift}
              onChange={(maximumPerShift) => patch({ maximumPerShift })}
            />
            <NumberField
              label="Maximum members per A-Day group"
              min={1}
              max={1000}
              value={distribution.maximumPerADay}
              onChange={(maximumPerADay) => patch({ maximumPerADay })}
            />
            <Button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              Remove membership distribution {index + 1}
            </Button>
          </fieldset>
        );
      })}
      {value !== undefined && (
        <Button
          type="button"
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                label: '',
                sourceRef: '',
                sourceDecisionId: '',
                membershipSource: 'REVIEWED_EXISTING_MEMBERS',
                memberIds: [],
                shifts: [],
                minimumPerShift: 0,
                maximumPerShift: 0,
                maximumPerADay: 0,
              },
            ])
          }
        >
          Add membership distribution
        </Button>
      )}
    </FieldSection>
  );
}
