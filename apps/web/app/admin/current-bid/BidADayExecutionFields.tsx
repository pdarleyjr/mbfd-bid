'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FrozenLiveBidPolicy } from '@mbfd/shared';
import { useId } from 'react';
import {
  CheckField,
  ChoiceField,
  NumberField,
  type ReferenceOption,
  ReferencePicker,
  TextField,
} from './BidFields';

type ADay = NonNullable<FrozenLiveBidPolicy['annualOperations']>['aDay'];
type Execution = NonNullable<ADay['execution']>;
type Constraint = Execution['constraints'][number];
type TimingException = NonNullable<Execution['timingExceptions']>[number];

const timingOptions: { value: Execution['timing']; label: string }[] = [
  { value: 'SIMULTANEOUS', label: 'With position selection' },
  { value: 'AFTER_POSITION_SELECTION', label: 'After position selection' },
];

const rankOptions: { value: Constraint['ranks'][number]; label: string }[] = [
  { value: 'CHIEF', label: 'Chief' },
  { value: 'DEP_CHIEF', label: 'Deputy Chief' },
  { value: 'DC', label: 'Division Chief' },
  { value: 'CPT', label: 'Captain' },
  { value: 'LT', label: 'Lieutenant' },
  { value: 'FF', label: 'Firefighter' },
];

/** Absence remains historical absence until an administrator explicitly configures timing. */
export function BidADayExecutionFields({
  value,
  opportunities,
  profiles,
  members,
  onChange,
}: {
  value: ADay['execution'];
  opportunities: ReferenceOption[];
  profiles: ReferenceOption[];
  members: ReferenceOption[];
  onChange(value: ADay['execution']): void;
}) {
  const officerId = useId();
  return (
    <div className="space-y-4 sm:col-span-2">
      <CheckField
        label="Configure A-Day selection"
        value={value !== undefined}
        onChange={(enabled) =>
          onChange(
            enabled
              ? {
                  timing: 'SIMULTANEOUS',
                  timingExceptions: [],
                  officersPerGroup: null,
                  sourceRef: '',
                  constraints: [],
                }
              : undefined,
          )
        }
      />
      {value === undefined ? (
        <p className="text-sm text-muted-foreground">
          A-Day selection timing has not been configured for this Bid.
        </p>
      ) : (
        <>
          <TextField
            label="A-Day execution source"
            value={value.sourceRef}
            help="Identify the approved policy or decision governing this A-Day timing model."
            onChange={(sourceRef) => onChange({ ...value, sourceRef })}
          />
          <ChoiceField
            label="A-Day selection timing"
            value={value.timing}
            options={timingOptions}
            onChange={(timing) => onChange({ ...value, timing })}
          />
          <p className="text-sm text-muted-foreground">
            Add a source-backed exception when an approved Timeline uses different timing for an
            identified opportunity or shared rule profile. Saved exceptions stay part of this
            version; they do not change an active Bid.
          </p>
          {(value.timingExceptions ?? []).map((exception, index) => {
            const update = (patch: Partial<TimingException>) =>
              onChange({
                ...value,
                timingExceptions: (value.timingExceptions ?? []).map((entry, i) =>
                  i === index ? { ...entry, ...patch } : entry,
                ),
              });
            return (
              <fieldset key={exception.id} className="space-y-4 rounded border border-border p-4">
                <legend className="px-1 font-medium">A-Day timing exception {index + 1}</legend>
                <TextField
                  label="Exception name"
                  value={exception.label}
                  onChange={(label) => update({ label })}
                />
                <TextField
                  label="Exception source"
                  value={exception.sourceRef}
                  onChange={(sourceRef) => update({ sourceRef })}
                />
                <ChoiceField
                  label="Exception timing"
                  value={exception.timing}
                  options={timingOptions}
                  onChange={(timing) => update({ timing })}
                />
                <ReferencePicker
                  label="Exception opportunities"
                  values={exception.positionIds}
                  options={opportunities}
                  onChange={(positionIds) => update({ positionIds })}
                  help="Choose the specialized opportunities governed by this Timeline exception."
                />
                <ReferencePicker
                  label="Exception shared profiles"
                  values={exception.profileIds}
                  options={profiles}
                  onChange={(profileIds) => update({ profileIds })}
                  help="The server compiles shared-profile scope during candidate review and save; use the reviewed result as the authoritative scope."
                />
                {!exception.positionIds.length && !exception.profileIds.length ? (
                  <p className="text-sm text-destructive">
                    Select at least one affected opportunity or shared profile before saving this
                    exception.
                  </p>
                ) : null}
                <Button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      timingExceptions: (value.timingExceptions ?? []).filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  Remove A-Day timing exception {index + 1}
                </Button>
              </fieldset>
            );
          })}
          <Button
            type="button"
            disabled={(value.timingExceptions ?? []).length >= 100}
            onClick={() =>
              onChange({
                ...value,
                timingExceptions: [
                  ...(value.timingExceptions ?? []),
                  {
                    id: crypto.randomUUID(),
                    label: '',
                    sourceRef: '',
                    timing: 'SIMULTANEOUS',
                    positionIds: [],
                    profileIds: [],
                  },
                ],
              })
            }
          >
            Add A-Day timing exception
          </Button>
          <div className="space-y-1">
            <Label htmlFor={officerId}>Exact officers per combat group</Label>
            <Input
              id={officerId}
              type="number"
              min={0}
              max={1000}
              step={1}
              value={value.officersPerGroup ?? ''}
              aria-describedby={`${officerId}-help`}
              onChange={(event) => {
                const text = event.target.value;
                const count = Number(text);
                if (text === '' || Number.isFinite(count))
                  onChange({ ...value, officersPerGroup: text === '' ? null : count });
              }}
            />
            <p id={`${officerId}-help`} className="text-xs text-muted-foreground">
              Leave blank when the approved policy imposes no exact officer count. Zero requires no
              officers.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Each named limit applies separately to every A-Day group or weekday on the selected
            shifts. A member counts when any selected opportunity, member or rank matches. Names do
            not select members.
          </p>
          {value.constraints.map((constraint, index) => {
            const update = (patch: Partial<Constraint>) =>
              onChange({
                ...value,
                constraints: value.constraints.map((entry, i) =>
                  i === index ? { ...entry, ...patch } : entry,
                ),
              });
            return (
              <fieldset key={constraint.id} className="space-y-4 rounded border border-border p-4">
                <legend className="px-1 font-medium">A-Day limit {index + 1}</legend>
                <TextField
                  label="Limit name"
                  value={constraint.label}
                  onChange={(label) => update({ label })}
                />
                <TextField
                  label="Limit source"
                  value={constraint.sourceRef}
                  onChange={(sourceRef) => update({ sourceRef })}
                />
                <NumberField
                  label="Maximum per A-Day"
                  value={constraint.maximum}
                  max={1000}
                  onChange={(maximum) => update({ maximum })}
                />
                <ReferencePicker
                  label="Applicable shifts"
                  values={constraint.shifts}
                  options={(['A', 'B', 'C', 'D'] as const).map((shift) => ({
                    value: shift,
                    label: `${shift} shift`,
                  }))}
                  onChange={(shifts) => update({ shifts: shifts as Constraint['shifts'] })}
                  help="Select every shift governed by this limit."
                />
                <ReferencePicker
                  label="Included opportunities"
                  values={constraint.positionIds}
                  options={opportunities}
                  onChange={(positionIds) => update({ positionIds })}
                />
                <ReferencePicker
                  label="Included members"
                  values={constraint.memberIds.map(String)}
                  options={members}
                  onChange={(memberIds) => update({ memberIds: memberIds.map(Number) })}
                />
                <ReferencePicker
                  label="Included ranks"
                  values={constraint.ranks}
                  options={rankOptions}
                  onChange={(ranks) => update({ ranks: ranks as Constraint['ranks'] })}
                />
                {!constraint.shifts.length ||
                !(
                  constraint.positionIds.length +
                  constraint.memberIds.length +
                  constraint.ranks.length
                ) ? (
                  <p className="text-sm text-destructive">
                    Select at least one shift and an opportunity, member or rank before saving this
                    limit.
                  </p>
                ) : null}
                <Button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      constraints: value.constraints.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove A-Day limit {index + 1}
                </Button>
              </fieldset>
            );
          })}
          <Button
            type="button"
            disabled={value.constraints.length >= 100}
            onClick={() =>
              onChange({
                ...value,
                constraints: [
                  ...value.constraints,
                  {
                    id: crypto.randomUUID(),
                    label: '',
                    sourceRef: '',
                    maximum: 0,
                    shifts: [],
                    positionIds: [],
                    memberIds: [],
                    ranks: [],
                  },
                ],
              })
            }
          >
            Add A-Day limit
          </Button>
        </>
      )}
    </div>
  );
}
