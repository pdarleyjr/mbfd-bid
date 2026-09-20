'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type BidDefinitionContent, FrozenLiveBidPolicySchema } from '@mbfd/shared';
import { FieldSection, ReferencePicker, TextField, useBidMembers } from './BidFields';

/** Unresolved source material stays visible and editable without supplying
 * runtime defaults. Activation still uses the existing strict policy parser. */
export function PendingPolicyReview({
  content,
  onChange,
}: {
  content: BidDefinitionContent;
  onChange(content: BidDefinitionContent): void;
}) {
  const people = useBidMembers();
  const draft = content.pendingPolicy;
  if (!draft) return null;
  const policy = draft.executionPolicy;
  const annual = policy.annualOperations;
  const update = (executionPolicy: typeof policy) =>
    onChange({ ...content, pendingPolicy: { ...draft, executionPolicy } });
  const ready = FrozenLiveBidPolicySchema.safeParse(policy);
  const datesReady = content.settings !== null && content.settings.v !== 1;
  const numberInput = (
    label: string,
    value: number | null,
    set: (value: number | null) => void,
  ) => (
    <Label className="block space-y-2">
      {label}
      <Input
        type="number"
        min={0}
        step={1}
        value={value ?? ''}
        placeholder="Unresolved"
        onChange={(event) => set(event.target.value === '' ? null : Number(event.target.value))}
      />
    </Label>
  );
  return (
    <FieldSection
      title="Source policy awaiting operational decisions"
      description="This saved policy is not executable. Unresolved values remain blank and grant no authority. Review the source decisions below before preparing a run."
    >
      <TextField
        label="Pending authoritative policy language"
        value={draft.policyText}
        multiline
        onChange={(policyText) => onChange({ ...content, pendingPolicy: { ...draft, policyText } })}
      />
      <details className="rounded border p-3">
        <summary>Stages and participants</summary>
        {policy.stages.map((stage, index) => (
          <ReferencePicker
            key={stage.id}
            label={`${stage.label} participants`}
            values={stage.memberIds.map(String)}
            options={people.data ?? []}
            onChange={(ids) =>
              update({
                ...policy,
                stages: policy.stages.map((entry, i) =>
                  i === index ? { ...entry, memberIds: ids.map(Number) } : entry,
                ),
              })
            }
          />
        ))}
        <p className="text-sm text-muted-foreground">
          Saved participant filters and source-certified ordering remain attached to these stages.
          Run preparation rechecks the exact Department evidence.
        </p>
      </details>
      <details className="rounded border p-3">
        <summary>Real Bid action authority</summary>
        {policy.actionPermissions.map((grant, index) => (
          <ReferencePicker
            key={grant.action}
            label={grant.action.replaceAll('_', ' ')}
            values={grant.actorMemberIds.map(String)}
            options={people.data ?? []}
            onChange={(ids) =>
              update({
                ...policy,
                actionPermissions: policy.actionPermissions.map((entry, i) =>
                  i === index ? { ...entry, actorMemberIds: ids.map(Number) } : entry,
                ),
              })
            }
          />
        ))}
      </details>
      {annual ? (
        <details className="space-y-3 rounded border p-3">
          <summary>Contact and A-Day decisions</summary>
          {numberInput(
            'Required contact attempts',
            annual.contact.minimumAttempts,
            (minimumAttempts) =>
              update({
                ...policy,
                annualOperations: { ...annual, contact: { ...annual.contact, minimumAttempts } },
              }),
          )}
          {(['min', 'max', 'captainDcMax'] as const).map((key) => (
            <div key={key}>
              {numberInput(
                {
                  min: 'General minimum per A-Day group',
                  max: 'General maximum per A-Day group',
                  captainDcMax: 'Captain / DC maximum per group',
                }[key],
                annual.aDay[key],
                (value) =>
                  update({
                    ...policy,
                    annualOperations: { ...annual, aDay: { ...annual.aDay, [key]: value } },
                  }),
              )}
            </div>
          ))}
          {numberInput(
            'Marine float maximum per group',
            annual.aDay.specialtyMaximums.MARINE_FLOAT,
            (value) =>
              update({
                ...policy,
                annualOperations: {
                  ...annual,
                  aDay: {
                    ...annual.aDay,
                    specialtyMaximums: { ...annual.aDay.specialtyMaximums, MARINE_FLOAT: value },
                  },
                },
              }),
          )}
          <p>
            {annual.aDay.execution?.constraints.length ?? 0} source-specific A-Day constraints,{' '}
            {annual.fallbackPolicies?.length ?? 0} fallback policies,{' '}
            {annual.assignmentTerms?.length ?? 0} assignment terms and{' '}
            {annual.opportunityPools?.length ?? 0} opportunity pools are saved.
          </p>
        </details>
      ) : null}
      <Button
        type="button"
        disabled={!ready.success || !datesReady}
        onClick={() => {
          if (!ready.success || !content.settings || content.settings.v === 1) return;
          const { pendingPolicy: _pending, ...remaining } = content;
          onChange({
            ...remaining,
            settings: { ...content.settings, v: 3, livePolicy: ready.data },
            policy: { ...draft, executionPolicy: ready.data },
          });
        }}
      >
        Use reviewed procedures in this draft
      </Button>
      <p className="text-sm text-muted-foreground">
        Requires complete participants, action grants, numeric settings and evaluation dates. This
        only edits the draft; Save and Real readiness checks remain separate.
      </p>
    </FieldSection>
  );
}
