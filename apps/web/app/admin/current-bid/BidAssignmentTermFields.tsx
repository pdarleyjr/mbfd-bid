'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FrozenLiveBidPolicy } from '@mbfd/shared';
import {
  CheckField,
  FieldSection,
  type ReferenceOption,
  ReferencePicker,
  TextField,
} from './BidFields';

type Terms = NonNullable<FrozenLiveBidPolicy['annualOperations']>['assignmentTerms'];

export function BidAssignmentTermFields({
  value,
  opportunities,
  onChange,
}: {
  value: Terms;
  opportunities: ReferenceOption[];
  onChange(value: Terms): void;
}) {
  return (
    <FieldSection
      title="Assignment terms"
      description="Service time determines when a member may leave. Consecutive bid cycles determine when an assignment reopens annually. Record the approved policy for each scope separately."
    >
      <CheckField
        label="Configure assignment terms"
        value={value !== undefined}
        onChange={(enabled) => onChange(enabled ? [] : undefined)}
      />
      {value === undefined ? (
        <p className="text-sm text-muted-foreground">
          This saved Bid has no assignment-term rules configured.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Department tenure evidence supplies the reviewed holder, accumulated service and
            consecutive cycles. Incomplete facts require review before an assignment can be offered
            or released.
          </p>
          {value.map((term, index) => {
            const patch = (changes: Partial<typeof term>) =>
              onChange(value.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)));
            return (
              <fieldset key={term.id} className="space-y-4 rounded border border-border p-4">
                <legend className="px-1 font-medium">Assignment term {index + 1}</legend>
                <TextField
                  label="Assignment term source"
                  value={term.sourceRef}
                  onChange={(sourceRef) => patch({ sourceRef })}
                />
                <ReferencePicker
                  label="Term opportunities"
                  values={term.positionIds}
                  options={opportunities}
                  onChange={(positionIds) => patch({ positionIds })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Label>
                    Service months required before leaving
                    <Input
                      type="number"
                      min={1}
                      max={1200}
                      step={1}
                      value={term.requiredServiceMonths || ''}
                      onChange={(event) =>
                        patch({
                          requiredServiceMonths:
                            event.target.value === '' ? 0 : Number(event.target.value),
                        })
                      }
                    />
                  </Label>
                  <Label>
                    Consecutive bid cycles before annual reopening
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={term.reopenAfterConsecutiveCycles || ''}
                      onChange={(event) =>
                        patch({
                          reopenAfterConsecutiveCycles:
                            event.target.value === '' ? 0 : Number(event.target.value),
                        })
                      }
                    />
                  </Label>
                </div>
                <CheckField
                  label="Closed for this Bid"
                  value={term.closedForThisBid}
                  onChange={(closedForThisBid) => patch({ closedForThisBid })}
                />
                <Button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
                  Remove assignment term {index + 1}
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
                  positionIds: [],
                  requiredServiceMonths: 0,
                  reopenAfterConsecutiveCycles: 0,
                  closedForThisBid: false,
                  sourceRef: '',
                },
              ])
            }
          >
            Add assignment term
          </Button>
        </>
      )}
    </FieldSection>
  );
}
