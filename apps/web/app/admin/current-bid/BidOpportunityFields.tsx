'use client';
import { Button } from '@/components/ui/button';
import type { BidDefinitionContent } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { CheckField, ChoiceField, FieldSection, ReferencePicker, TextField } from './BidFields';
import { BidRuleFields } from './BidRuleFields';

type Position = BidDefinitionContent['positions'][number];
export function BidOpportunityFields({
  content,
  onChange,
}: { content: BidDefinitionContent; onChange(content: BidDefinitionContent): void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [removeReview, setRemoveReview] = useState(false);
  const [removeRuleReview, setRemoveRuleReview] = useState<string | null>(null);
  const asOf =
    content.planning?.effectiveOn ??
    (content.settings && content.settings.v !== 1
      ? (content.settings.personnelEvaluationOn ?? content.settings.credentialEvaluationOn)
      : '');
  const department = useQuery({
    queryKey: ['admin', 'current-bid', 'staffing-options', asOf],
    enabled: selected !== null && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
    staleTime: 30_000,
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/department/current-roster?as_of=${encodeURIComponent(asOf)}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Department staffing positions unavailable');
      const schema = z.object({
        asOf: z.literal(asOf),
        positions: z.array(
          z.object({
            id: z.string(),
            stableSlotKey: z.string(),
            positionName: z.string().nullable(),
            shift: z.string().nullable(),
            station: z.string().nullable(),
            unit: z.string().nullable(),
          }),
        ),
      });
      return schema.parse(await response.json()).positions.map((p) => ({
        value: p.id,
        label: `${p.positionName ?? p.stableSlotKey} · ${p.shift ?? 'Shift not recorded'} · ${p.station ?? 'Station not recorded'} · ${p.unit ?? 'Unit not recorded'} · ${p.stableSlotKey}`,
      }));
    },
  });
  const position = content.positions.find((p) => p.id === selected);
  const filtered = content.positions.filter((p) =>
    `${p.id} ${p.positionName} ${p.station} ${p.unit} ${p.shift}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const rule = content.rules.find((r) => r.positionId === selected);
  const participation = content.participation.find((p) => p.positionId === selected);
  const binding = content.staffingBindings.find((p) => p.positionId === selected);
  const update = (patch: Partial<Position>) =>
    onChange({
      ...content,
      positions: content.positions.map((p) => (p.id === selected ? { ...p, ...patch } : p)),
    });
  return (
    <div className="min-w-0 space-y-4">
      <FieldSection
        title="Opportunities & positions"
        description="Choose an opportunity to edit its requirements, scoring and tie breaks. Department staffing records remain separate."
      >
        <TextField
          label="Find an opportunity"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
        />
        <p className="text-sm text-muted-foreground">
          {filtered.length} matching opportunities · {content.positions.length} total
        </p>
        <div className="grid min-w-0 gap-2 md:grid-cols-2">
          {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map((p) => (
            <Button
              type="button"
              key={p.id}
              aria-pressed={selected === p.id}
              className={`justify-start text-left ${selected === p.id ? 'border-primary bg-accent' : ''}`}
              onClick={() => {
                setSelected(p.id);
                setRemoveReview(false);
                setRemoveRuleReview(null);
              }}
            >
              <span className="min-w-0 break-words">
                <span className="block font-semibold">{p.positionName || 'Name required'}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {p.shift} shift · {p.station} · {p.unit} · {p.id}
                </span>
              </span>
            </Button>
          ))}
        </div>
        {!filtered.length && <p>No matching opportunities.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            Previous opportunities
          </Button>
          <span className="text-sm">
            Page {currentPage + 1} of {pages}
          </span>
          <Button
            type="button"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next opportunities
          </Button>
          <Button type="button" onClick={() => setCreating(true)}>
            Add opportunity
          </Button>
        </div>
        {creating && (
          <div className="space-y-3 rounded border border-border p-4">
            <TextField
              label="New opportunity identifier"
              value={newId}
              onChange={setNewId}
              help="Use the approved opportunity identifier. Existing identifiers are preserved."
            />
            <Button
              type="button"
              disabled={
                !newId.trim() ||
                newId !== newId.trim() ||
                content.positions.some((p) => p.id === newId)
              }
              onClick={() => {
                onChange({
                  ...content,
                  positions: [
                    ...content.positions,
                    {
                      id: newId,
                      positionName: '',
                      shift: 'A',
                      station: '',
                      unit: '',
                      division: '',
                      rankRequired: 'FF',
                      isFloating: false,
                      isVacantByDesign: false,
                      isExcludedFromCount: false,
                    },
                  ],
                });
                setSelected(newId);
                setCreating(false);
                setNewId('');
              }}
            >
              Add to draft
            </Button>
            <Button type="button" onClick={() => setCreating(false)}>
              Cancel addition
            </Button>
            <p className="text-xs text-muted-foreground">
              Review the shift, rank and participation before saving. Required descriptive fields
              start empty.
            </p>
          </div>
        )}
      </FieldSection>
      {position && (
        <>
          <FieldSection
            title={position.positionName || position.id}
            description={`Opportunity ${position.id}`}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Opportunity name"
                value={position.positionName}
                onChange={(positionName) => update({ positionName })}
              />
              <TextField
                label="Division"
                value={position.division}
                onChange={(division) => update({ division })}
              />
              <TextField
                label="Station"
                value={position.station}
                onChange={(station) => update({ station })}
              />
              <TextField label="Unit" value={position.unit} onChange={(unit) => update({ unit })} />
              <ChoiceField
                label="Shift"
                value={position.shift}
                options={(['A', 'B', 'C', 'D'] as const).map((value) => ({ value, label: value }))}
                onChange={(shift) => update({ shift })}
              />
              <ChoiceField
                label="Required rank"
                value={position.rankRequired}
                options={(['FF', 'LT', 'CPT', 'DC'] as const).map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(rankRequired) => update({ rankRequired })}
              />
            </div>
            <CheckField
              label="Floating opportunity"
              value={position.isFloating}
              onChange={(isFloating) => update({ isFloating })}
            />
            <CheckField
              label="Vacant by design"
              value={position.isVacantByDesign}
              onChange={(isVacantByDesign) => update({ isVacantByDesign })}
            />
            <CheckField
              label="Excluded from legacy position counts"
              value={position.isExcludedFromCount}
              onChange={(isExcludedFromCount) => update({ isExcludedFromCount })}
            />
            <ChoiceField
              label="Bid participation"
              value={participation?.bidParticipation ?? 'IMPLICIT'}
              options={[
                { value: 'IMPLICIT', label: 'Existing implicit participation' },
                { value: 'BIDDABLE', label: 'Available for bidding' },
                { value: 'ADMIN_ASSIGNED_NON_BIDDABLE', label: 'Administratively assigned' },
                { value: 'RESERVED_NON_BIDDABLE', label: 'Reserved; unavailable for bidding' },
              ]}
              onChange={(value) =>
                onChange({
                  ...content,
                  participation:
                    value === 'IMPLICIT'
                      ? content.participation.filter((p) => p.positionId !== position.id)
                      : [
                          ...content.participation.filter((p) => p.positionId !== position.id),
                          {
                            positionId: position.id,
                            bidParticipation: value as
                              | 'BIDDABLE'
                              | 'ADMIN_ASSIGNED_NON_BIDDABLE'
                              | 'RESERVED_NON_BIDDABLE',
                            authoritativeSourceRef: participation?.authoritativeSourceRef ?? '',
                          },
                        ],
                })
              }
            />
            {participation && (
              <TextField
                label="Participation authority"
                value={participation.authoritativeSourceRef}
                onChange={(authoritativeSourceRef) =>
                  onChange({
                    ...content,
                    participation: content.participation.map((p) =>
                      p.positionId === position.id ? { ...p, authoritativeSourceRef } : p,
                    ),
                  })
                }
              />
            )}
            <FieldSection
              title="Department staffing connection"
              description={
                asOf
                  ? `Staffing positions effective ${asOf}. Select one position; selecting another replaces the draft connection.`
                  : 'Choose a planning or evidence date in Timing to load Department staffing positions.'
              }
            >
              {department.isError && (
                <p role="alert">
                  Department staffing positions could not be loaded. Existing connections are
                  retained.
                </p>
              )}
              <ReferencePicker
                label="Staffing position"
                values={binding ? [binding.staffingPositionId] : []}
                options={department.data ?? []}
                onChange={(values) => {
                  const staffingPositionId = values.at(-1);
                  onChange({
                    ...content,
                    staffingBindings: [
                      ...content.staffingBindings.filter((b) => b.positionId !== position.id),
                      ...(staffingPositionId
                        ? [
                            {
                              positionId: position.id,
                              staffingPositionId,
                              authoritativeSourceRef:
                                binding?.staffingPositionId === staffingPositionId
                                  ? binding.authoritativeSourceRef
                                  : '',
                              reviewStatus:
                                binding?.staffingPositionId === staffingPositionId
                                  ? binding.reviewStatus
                                  : ('draft' as const),
                            },
                          ]
                        : []),
                    ],
                  });
                }}
              />
              {binding && (
                <>
                  <TextField
                    label="Staffing connection authority"
                    value={binding.authoritativeSourceRef}
                    onChange={(authoritativeSourceRef) =>
                      onChange({
                        ...content,
                        staffingBindings: content.staffingBindings.map((b) =>
                          b.positionId === position.id ? { ...b, authoritativeSourceRef } : b,
                        ),
                      })
                    }
                  />
                  <ChoiceField
                    label="Staffing connection review"
                    value={binding.reviewStatus}
                    options={[
                      { value: 'draft', label: 'Needs review' },
                      { value: 'approved', label: 'Reviewed and approved' },
                      { value: 'retired', label: 'Retired connection' },
                    ]}
                    onChange={(reviewStatus) =>
                      onChange({
                        ...content,
                        staffingBindings: content.staffingBindings.map((b) =>
                          b.positionId === position.id ? { ...b, reviewStatus } : b,
                        ),
                      })
                    }
                  />
                </>
              )}
            </FieldSection>
            <details>
              <summary className="min-h-11 content-center cursor-pointer text-sm">
                Remove this opportunity
              </summary>
              <p className="my-3 text-sm">
                Removing it from the draft also removes its requirements and participation. Saved
                versions and active runs retain their original content. Policy references must be
                repaired before the server will accept the draft.
              </p>
              {!removeReview ? (
                <Button type="button" onClick={() => setRemoveReview(true)}>
                  Review removal
                </Button>
              ) : (
                <div className="space-y-3">
                  <output className="block">
                    This draft will lose {rule ? 'one rule' : 'no rule'},{' '}
                    {participation ? 'one participation record' : 'no participation record'} and{' '}
                    {binding ? 'one staffing connection' : 'no staffing connection'} for{' '}
                    {position.id}.
                  </output>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      onChange({
                        ...content,
                        positions: content.positions.filter((p) => p.id !== position.id),
                        rules: content.rules.filter((r) => r.positionId !== position.id),
                        participation: content.participation.filter(
                          (p) => p.positionId !== position.id,
                        ),
                        staffingBindings: content.staffingBindings.filter(
                          (p) => p.positionId !== position.id,
                        ),
                      });
                      setSelected(null);
                      setRemoveReview(false);
                    }}
                  >
                    Remove from draft
                  </Button>
                  <Button type="button" onClick={() => setRemoveReview(false)}>
                    Keep opportunity
                  </Button>
                </div>
              )}
            </details>
          </FieldSection>
          {rule ? (
            <>
              <FieldSection title="Bid rule">
                {(position.isExcludedFromCount ||
                  (participation && participation.bidParticipation !== 'BIDDABLE')) && (
                  <p role="alert" className="text-sm">
                    This opportunity is configured outside ordinary bidding. Remove its Bid rule
                    before saving, or restore its biddable participation.
                  </p>
                )}
                {removeRuleReview === position.id ? (
                  <>
                    <p className="text-sm">
                      Remove the requirements, point awards and tie breaks for {position.id} from
                      this draft? The opportunity, staffing connection and historical versions
                      remain.
                    </p>
                    <Button
                      type="button"
                      onClick={() => {
                        onChange({
                          ...content,
                          rules: content.rules.filter((r) => r.positionId !== position.id),
                        });
                        setRemoveRuleReview(null);
                      }}
                    >
                      Confirm rule removal
                    </Button>
                    <Button type="button" onClick={() => setRemoveRuleReview(null)}>
                      Keep Bid rule
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={() => setRemoveRuleReview(position.id)}>
                    Review rule removal
                  </Button>
                )}
              </FieldSection>
              <BidRuleFields
                key={position.id}
                rule={rule}
                onChange={(updated) =>
                  onChange({
                    ...content,
                    rules: content.rules.map((r) => (r.positionId === position.id ? updated : r)),
                  })
                }
              />
            </>
          ) : (
            <FieldSection title="Requirements not configured">
              <p className="text-sm">
                A biddable opportunity needs a valid rule before a run can be created.
              </p>
              <Button
                type="button"
                disabled={
                  position.isExcludedFromCount ||
                  (!!participation && participation.bidParticipation !== 'BIDDABLE')
                }
                onClick={() =>
                  onChange({
                    ...content,
                    rules: [
                      ...content.rules,
                      {
                        positionId: position.id,
                        requiredCriteriaJson: JSON.stringify({
                          rank: [position.rankRequired],
                          credentials: [],
                          custom: [],
                        }),
                        pointsPreferenceJson: JSON.stringify({ max: 0, items: [] }),
                        tieBreakChainJson: '[]',
                        notes: null,
                      },
                    ],
                  })
                }
              >
                Configure requirements
              </Button>
            </FieldSection>
          )}
        </>
      )}
    </div>
  );
}
