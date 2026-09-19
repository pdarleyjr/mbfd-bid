'use client';

import { ConfiguredScoringEditor } from '@/app/admin/positions/[id]/edit/ConfiguredScoringEditor';
import { PostAwardObligationsEditor } from '@/components/admin/PostAwardObligationsEditor';
import { ServiceRequirementsEditor } from '@/components/admin/ServiceRequirementsEditor';
import { Button } from '@/components/ui/button';
import { useCredentialCatalog } from '@/lib/use-credential-catalog';
import {
  type BidDefinitionRule,
  type ConfiguredScoring,
  ConfiguredScoringSchema,
  type PostAwardObligation,
  PostAwardObligationsSchema,
  RULE_CUSTOM_CRITERIA,
  RULE_RANKS,
  RULE_TIE_BREAK_KEYS,
} from '@mbfd/shared';
import { z } from 'zod';
import {
  ChoiceField,
  FieldSection,
  NullableText,
  NumberField,
  OrderedChoices,
  ReferencePicker,
} from './BidFields';
import { draftShape } from './bid-draft';

// Shape checks protect rendering. The existing Worker decoder validates policy.
const requiredShape = z
  .object({
    rank: z.array(z.enum(RULE_RANKS)),
    credentials: z.array(z.string()),
    custom: z.array(z.enum(RULE_CUSTOM_CRITERIA)),
    anyOfCredentials: z.array(z.array(z.string())).optional(),
    service: z
      .array(z.object({ serviceCode: z.string(), minimumMonths: z.number() }).strict())
      .optional(),
    postAward: (
      draftShape(PostAwardObligationsSchema) as z.ZodType<PostAwardObligation[]>
    ).optional(),
  })
  .strict();
const pointsShape = z
  .object({
    max: z.number(),
    items: z.array(
      z
        .object({
          credential: z.string(),
          points: z.number(),
          requiresOpsPair: z.boolean(),
          opsGate: z.enum(['paired_operation', 'all_operations']).optional(),
        })
        .strict(),
    ),
    scoring: (draftShape(ConfiguredScoringSchema) as z.ZodType<ConfiguredScoring>).optional(),
  })
  .strict()
  .refine((value) => value.scoring === undefined || (value.max === 0 && value.items.length === 0));
const tieShape = z.array(z.enum(RULE_TIE_BREAK_KEYS));
export function readRuleFields(rule: BidDefinitionRule) {
  try {
    return {
      required: requiredShape.parse(JSON.parse(rule.requiredCriteriaJson)),
      points: pointsShape.parse(JSON.parse(rule.pointsPreferenceJson)),
      ties: tieShape.parse(JSON.parse(rule.tieBreakChainJson)),
    };
  } catch {
    return null;
  }
}
const tieLabels = {
  points: 'Total points',
  so_points: 'Special Operations points',
  mo_points: 'Marine Operations points',
  rsc_seniority: 'RSC seniority',
  rank_seniority: 'Rank seniority',
  time_in_grade_bid_ordinal: 'Time-in-grade Bid ordinal',
  department_service_bid_ordinal: 'Department-service Bid ordinal',
};
export function BidRuleFields({
  rule,
  onChange,
}: { rule: BidDefinitionRule; onChange(rule: BidDefinitionRule): void }) {
  const catalog = useCredentialCatalog();
  const fields = readRuleFields(rule);
  if (!fields)
    return (
      <p role="alert">
        This rule contains fields that this editor cannot safely display. Its original content is
        retained. Refresh the Bid or review the supported rule format.
      </p>
    );
  const { required, points, ties } = fields;
  const options = (catalog.data ?? []).map((c) => ({
    value: c.policyName ?? c.name,
    label: `${c.name}${c.retiredOn ? ' · Retired' : ''}`,
  }));
  const updateRequired = (patch: Partial<typeof required>) =>
    onChange({ ...rule, requiredCriteriaJson: JSON.stringify({ ...required, ...patch }) });
  const updatePoints = (patch: Partial<typeof points>) =>
    onChange({ ...rule, pointsPreferenceJson: JSON.stringify({ ...points, ...patch }) });
  return (
    <div className="space-y-4">
      {catalog.isError && (
        <p role="alert">Qualification catalog unavailable. Saved selections remain visible.</p>
      )}
      <FieldSection
        title="Requirements"
        description="Every requirement must be satisfied. These controls change the draft; the Bid engine evaluates eligibility."
      >
        <ReferencePicker
          label="Eligible ranks"
          values={required.rank}
          options={RULE_RANKS.map((value) => ({ value, label: value }))}
          onChange={(rank) => updateRequired({ rank: rank as typeof required.rank })}
        />
        <ReferencePicker
          label="Required qualifications"
          values={required.credentials}
          options={options}
          onChange={(credentials) => updateRequired({ credentials })}
        />
        <ReferencePicker
          label="Additional requirements"
          values={required.custom}
          options={RULE_CUSTOM_CRITERIA.map((value) => ({
            value,
            label: value.replaceAll('_', ' '),
          }))}
          onChange={(custom) => updateRequired({ custom: custom as typeof required.custom })}
        />
        {(required.anyOfCredentials ?? []).map((group, index) => (
          <div key={`alternative-${index + 1}`} className="space-y-2">
            <ReferencePicker
              label={`Qualification alternatives ${index + 1}`}
              help="At least one selected qualification in this group is required. Every group must be satisfied."
              values={group}
              options={options}
              onChange={(next) =>
                updateRequired({
                  anyOfCredentials: required.anyOfCredentials?.map((v, i) =>
                    i === index ? next : v,
                  ),
                })
              }
            />
            <Button
              type="button"
              onClick={() =>
                updateRequired({
                  anyOfCredentials: required.anyOfCredentials?.filter((_, i) => i !== index),
                })
              }
            >
              Remove alternatives group {index + 1}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          onClick={() =>
            updateRequired({ anyOfCredentials: [...(required.anyOfCredentials ?? []), []] })
          }
        >
          Add qualification alternatives
        </Button>
        <ServiceRequirementsEditor
          value={required.service ?? []}
          onChange={(service) => updateRequired({ service })}
        />
        <PostAwardObligationsEditor
          value={(required.postAward ?? []) as PostAwardObligation[]}
          onChange={(postAward) => updateRequired({ postAward })}
        />
      </FieldSection>
      <FieldSection
        title="Credentials & points"
        description="Qualification evidence stays in Department. The values here apply to this Bid opportunity."
      >
        {points.scoring !== undefined ? (
          <>
            <ConfiguredScoringEditor
              value={points.scoring as ConfiguredScoring}
              onChange={(scoring) => updatePoints({ scoring })}
            />
            <Button
              type="button"
              onClick={() => {
                const { scoring: _scoring, ...rest } = points;
                onChange({ ...rule, pointsPreferenceJson: JSON.stringify(rest) });
              }}
            >
              Remove grouped scoring
            </Button>
          </>
        ) : (
          <>
            <NumberField
              label="Maximum points (0 means no cap)"
              value={points.max}
              onChange={(max) => updatePoints({ max })}
            />
            {points.max === 0 && (
              <p className="text-sm text-muted-foreground">
                Point awards are uncapped. Zero does not disable scoring.
              </p>
            )}
            {points.items.map((item, index) => (
              <fieldset
                key={`points-${index + 1}`}
                className="space-y-3 rounded border border-border p-3"
              >
                <legend className="px-1 font-medium">Point award {index + 1}</legend>
                <ChoiceField
                  label="Qualification"
                  value={item.credential}
                  options={[
                    { value: '', label: 'Choose qualification' },
                    ...options,
                    ...(!options.some((o) => o.value === item.credential) && item.credential
                      ? [
                          {
                            value: item.credential,
                            label: `${item.credential} · Saved qualification`,
                          },
                        ]
                      : []),
                  ]}
                  onChange={(credential) =>
                    updatePoints({
                      items: points.items.map((v, i) => (i === index ? { ...v, credential } : v)),
                    })
                  }
                />
                <NumberField
                  label="Points"
                  value={item.points}
                  onChange={(value) =>
                    updatePoints({
                      items: points.items.map((v, i) =>
                        i === index ? { ...v, points: value } : v,
                      ),
                    })
                  }
                />
                <ChoiceField
                  label="Operations requirement"
                  value={item.opsGate ?? (item.requiresOpsPair ? 'paired_operation' : 'none')}
                  options={[
                    { value: 'none', label: 'No additional Operations requirement' },
                    {
                      value: 'paired_operation',
                      label:
                        'Paired Operations requirement for the six supported Technician credentials',
                    },
                    { value: 'all_operations', label: 'All six Operations qualifications' },
                  ]}
                  onChange={(gate) =>
                    updatePoints({
                      items: points.items.map((v, i) => {
                        if (i !== index) return v;
                        const { opsGate: _gate, ...rest } = v;
                        return {
                          ...rest,
                          requiresOpsPair: gate === 'paired_operation',
                          ...(gate === 'none'
                            ? {}
                            : { opsGate: gate as 'paired_operation' | 'all_operations' }),
                        };
                      }),
                    })
                  }
                />
                <Button
                  type="button"
                  onClick={() =>
                    updatePoints({ items: points.items.filter((_, i) => i !== index) })
                  }
                >
                  Remove point award {index + 1}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              onClick={() =>
                updatePoints({
                  items: [...points.items, { credential: '', points: 0, requiresOpsPair: false }],
                })
              }
            >
              Add point award
            </Button>
            {!points.items.length && points.max === 0 && (
              <Button
                type="button"
                onClick={() => updatePoints({ scoring: { v: 1, total: [], so: [], mo: [] } })}
              >
                Configure grouped scoring
              </Button>
            )}
          </>
        )}
      </FieldSection>
      <FieldSection title="Tie breaks">
        <OrderedChoices
          label="Tie break"
          values={ties}
          options={RULE_TIE_BREAK_KEYS.map((value) => ({ value, label: tieLabels[value] }))}
          onChange={(value) => onChange({ ...rule, tieBreakChainJson: JSON.stringify(value) })}
        />
      </FieldSection>
      <NullableText
        label="Rule notes"
        value={rule.notes}
        onChange={(notes) => onChange({ ...rule, notes })}
        multiline
      />
    </div>
  );
}
