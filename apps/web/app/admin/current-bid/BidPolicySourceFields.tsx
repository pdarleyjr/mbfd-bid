'use client';
import { Button } from '@/components/ui/button';
import type { BidDefinitionContent, FrozenLiveBidPolicy } from '@mbfd/shared';
import {
  CheckField,
  ChoiceField,
  FieldSection,
  NullableText,
  NumberField,
  TextField,
} from './BidFields';

export function BidPolicySourceFields({
  content,
  section,
  policy,
  updatePolicy,
  onChange,
}: {
  content: BidDefinitionContent;
  section: 'language' | 'timing';
  policy: FrozenLiveBidPolicy | null;
  updatePolicy(policy: FrozenLiveBidPolicy): void;
  onChange(content: BidDefinitionContent): void;
}) {
  if (section === 'language')
    return (
      <div className="space-y-4">
        <FieldSection
          title="Policy & language"
          description="Keep the source language beside the configured behavior. Saving records both in the same Bid version."
        >
          {content.policy ? (
            <TextField
              label="Authoritative policy language"
              multiline
              value={content.policy.policyText}
              onChange={(policyText) =>
                onChange({
                  ...content,
                  policy: content.policy ? { ...content.policy, policyText } : null,
                })
              }
            />
          ) : (
            <>
              <p className="text-sm">No source language is attached to this Bid.</p>
              {policy && (
                <Button
                  type="button"
                  onClick={() =>
                    onChange({ ...content, policy: { policyText: '', executionPolicy: policy } })
                  }
                >
                  Add policy language
                </Button>
              )}
            </>
          )}
          {policy && (
            <TextField
              label="Policy reference or revision"
              value={policy.policyRevision}
              onChange={(policyRevision) => updatePolicy({ ...policy, policyRevision })}
            />
          )}
          <NullableText
            label="Bid notes"
            value={content.notes.bid}
            onChange={(bid) => onChange({ ...content, notes: { ...content.notes, bid } })}
            multiline
          />
          <NullableText
            label="Opportunity notes"
            value={content.notes.positions}
            onChange={(positions) =>
              onChange({ ...content, notes: { ...content.notes, positions } })
            }
            multiline
          />
        </FieldSection>
        <FieldSection
          title="Source decisions"
          description="Record a source, the interpretation and its effective date. An open decision remains visibly unresolved."
        >
          {content.sourceDecisions.map((decision, index) => (
            <details key={decision.issueId} className="rounded border border-border p-3">
              <summary className="min-h-11 content-center cursor-pointer font-medium">
                {decision.title || decision.issueId} ·{' '}
                {decision.status === 'OPEN' ? 'Open' : 'Resolved'}
              </summary>
              <div className="mt-3 space-y-3">
                {(['title', 'question', 'decision', 'sourceRef', 'effectiveOn'] as const).map(
                  (field) => (
                    <TextField
                      key={field}
                      label={
                        {
                          title: 'Title',
                          question: 'Question',
                          decision: 'Decision',
                          sourceRef: 'Source reference',
                          effectiveOn: 'Effective date',
                        }[field]
                      }
                      value={decision[field]}
                      type={field === 'effectiveOn' ? 'date' : 'text'}
                      multiline={field === 'decision' || field === 'question'}
                      onChange={(value) =>
                        onChange({
                          ...content,
                          sourceDecisions: content.sourceDecisions.map((d, i) =>
                            i === index ? { ...d, [field]: value } : d,
                          ),
                        })
                      }
                    />
                  ),
                )}
                <ChoiceField
                  label="Decision area"
                  value={decision.area}
                  options={(['positions', 'rules', 'annual-policy', 'annual-plan'] as const).map(
                    (value) => ({
                      value,
                      label: {
                        positions: 'Opportunities',
                        rules: 'Requirements and points',
                        'annual-policy': 'Operating procedures',
                        'annual-plan': 'Bid preparation',
                      }[value],
                    }),
                  )}
                  onChange={(area) =>
                    onChange({
                      ...content,
                      sourceDecisions: content.sourceDecisions.map((d, i) =>
                        i === index ? { ...d, area } : d,
                      ),
                    })
                  }
                />
                <CheckField
                  label="Decision resolved"
                  value={decision.status === 'RESOLVED'}
                  onChange={(resolved) =>
                    onChange({
                      ...content,
                      sourceDecisions: content.sourceDecisions.map((d, i) =>
                        i === index ? { ...d, status: resolved ? 'RESOLVED' : 'OPEN' } : d,
                      ),
                    })
                  }
                />
                <p className="text-sm text-muted-foreground">
                  Resolving a decision requires a complete title, question, reviewed decision and
                  source reference. Each needs at least four characters. Leave it open while the
                  evidence is incomplete.
                </p>
              </div>
            </details>
          ))}
          <Button
            type="button"
            onClick={() =>
              onChange({
                ...content,
                sourceDecisions: [
                  ...content.sourceDecisions,
                  {
                    issueId: crypto.randomUUID(),
                    title: '',
                    question: '',
                    area: 'annual-policy',
                    status: 'OPEN',
                    decision: '',
                    sourceRef: '',
                    effectiveOn: '',
                  },
                ],
              })
            }
          >
            Add source decision
          </Button>
        </FieldSection>
      </div>
    );
  return (
    <FieldSection
      title="Timing & evidence dates"
      description="Dates select the Department evidence used by this Bid. They do not change the current Department roster."
    >
      {content.settings ? (
        <>
          <NumberField
            label="Expected Bid duration (days)"
            min={1}
            max={7}
            value={content.settings.expectedDurationDays}
            onChange={(expectedDurationDays) => {
              if (content.settings)
                onChange({ ...content, settings: { ...content.settings, expectedDurationDays } });
            }}
          />
          <NumberField
            label="Turn timer (seconds)"
            min={30}
            max={600}
            value={content.settings.turnTimerSeconds}
            onChange={(turnTimerSeconds) => {
              if (content.settings)
                onChange({ ...content, settings: { ...content.settings, turnTimerSeconds } });
            }}
          />
          {content.settings.v !== 1 ? (
            <>
              <TextField
                label="Qualification evaluation date"
                type="date"
                value={content.settings.credentialEvaluationOn}
                onChange={(credentialEvaluationOn) => {
                  if (content.settings && content.settings.v !== 1)
                    onChange({
                      ...content,
                      settings: { ...content.settings, credentialEvaluationOn },
                    });
                }}
              />
              <CheckField
                label="Use a separate personnel evaluation date"
                value={content.settings.personnelEvaluationOn !== undefined}
                onChange={(enabled) => {
                  if (!content.settings || content.settings.v === 1) return;
                  const { personnelEvaluationOn: _date, ...settings } = content.settings;
                  onChange({
                    ...content,
                    settings: enabled ? { ...settings, personnelEvaluationOn: '' } : settings,
                  });
                }}
              />
              {content.settings.personnelEvaluationOn !== undefined && (
                <TextField
                  label="Personnel evaluation date"
                  type="date"
                  value={content.settings.personnelEvaluationOn}
                  onChange={(personnelEvaluationOn) => {
                    if (content.settings && content.settings.v !== 1)
                      onChange({
                        ...content,
                        settings: { ...content.settings, personnelEvaluationOn },
                      });
                  }}
                />
              )}
            </>
          ) : (
            <>
              <p className="text-sm">
                This older Bid does not specify an evidence date. Choose a date before preparing a
                new run.
              </p>
              <Button
                type="button"
                onClick={() => {
                  if (content.settings)
                    onChange({
                      ...content,
                      settings: { ...content.settings, v: 2, credentialEvaluationOn: '' },
                    });
                }}
              >
                Set qualification evaluation date
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <p>Timing has not been configured.</p>
          <Button
            type="button"
            onClick={() =>
              onChange({
                ...content,
                settings: {
                  v: 2,
                  expectedDurationDays: 0,
                  turnTimerSeconds: 0,
                  credentialEvaluationOn: '',
                },
              })
            }
          >
            Configure timing
          </Button>
        </>
      )}
      {content.planning && (
        <TextField
          label="Planning effective date"
          type="date"
          value={content.planning.effectiveOn}
          onChange={(effectiveOn) => {
            if (content.planning)
              onChange({ ...content, planning: { ...content.planning, effectiveOn } });
          }}
        />
      )}
    </FieldSection>
  );
}
