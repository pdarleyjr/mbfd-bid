'use client';
import { PostAwardObligationsEditor } from '@/components/admin/PostAwardObligationsEditor';
import { QualificationAlternativesEditor } from '@/components/admin/QualificationAlternativesEditor';
import { ServiceRequirementsEditor } from '@/components/admin/ServiceRequirementsEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import {
  type AnnualRuleProfile,
  AnnualRuleProfilesSchema,
  RULE_CUSTOM_CRITERIA,
  RULE_RANKS,
  RULE_TIE_BREAK_KEYS,
} from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ConfiguredScoringEditor } from '../positions/[id]/edit/ConfiguredScoringEditor';
import {
  type AnnualPlan,
  annualGet,
  annualPost,
  buttonClass,
  expectedPlan,
  fieldClass,
} from './annual-plan-client';
type Preview = {
  compiled: {
    rule: { positionId: string };
    provenance: {
      requirements: string[];
      scoring: string[];
      priorities: string[];
      matched: string[];
    };
  }[];
};
export function AnnualPlanProfiles({
  plan,
  onDirty,
  onSaved,
}: { plan: AnnualPlan; onDirty(v: boolean): void; onSaved(): Promise<void> }) {
  const saved = useQuery({
    queryKey: ['admin', 'annual-plan', plan.year, 'profiles'],
    queryFn: () =>
      annualGet<{ revision: number; ruleRevision: number | null; profiles: AnnualRuleProfile[] }>(
        `annual-plan/${plan.year}/profiles`,
      ),
    staleTime: 30_000,
  });
  const board = useQuery({
    queryKey: ['admin', 'annual-plan', plan.year, 'profile-positions', plan.ruleBookRevision],
    queryFn: async () => {
      const all = await Promise.all(
        ['A', 'B', 'C', 'D'].map((shift) =>
          annualGet<{
            seats: {
              id: string;
              station: string;
              position: string;
              rank: string;
              participation: string;
            }[];
          }>(`bid-board?view=upcoming&year=${plan.year}&shift=${shift}`),
        ),
      );
      return all.flatMap((r) => r.seats).filter((p) => p.participation === 'BIDDABLE');
    },
    staleTime: 30_000,
  });
  const catalog = useQuery({
    queryKey: ['admin', 'credentials'],
    queryFn: async () => {
      const rows: { id: number; name: string; policyName?: string; retiredOn?: string | null }[] =
        [];
      let total = 1;
      while (rows.length < total) {
        const body = await annualGet<{ credentials: typeof rows; total: number }>(
          `credentials?limit=500&offset=${rows.length}`,
        );
        if (!body.credentials.length && rows.length < body.total)
          throw new Error('Incomplete credential catalog');
        rows.push(...body.credentials);
        total = body.total;
      }
      return rows;
    },
    staleTime: 30_000,
  });
  const [draft, setDraft] = useState<AnnualRuleProfile[] | null>(null);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const revision = useRef<ReturnType<typeof expectedPlan> | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const profiles = draft ?? saved.data?.profiles ?? [];
  const profile = profiles.find((p) => p.id === selected);
  const dirty = draft !== null || reason !== '';
  useUnsavedChanges(dirty, 'annual profile edits');
  function change(next: AnnualRuleProfile[]) {
    if (!revision.current) revision.current = expectedPlan(plan);
    setDraft(next);
    setPreview(null);
    onDirty(true);
  }
  function patch(update: Partial<AnnualRuleProfile>) {
    if (profile) change(profiles.map((p) => (p.id === profile.id ? { ...p, ...update } : p)));
  }
  function add() {
    const id = crypto.randomUUID();
    change([
      ...profiles,
      {
        id,
        name: '',
        sourceRef: '',
        scope: { kind: 'department' },
        requirements: { credentials: [], custom: [] },
      },
    ]);
    setSelected(id);
  }
  const stale =
    revision.current !== null &&
    (revision.current.expected_rule_revision !== plan.ruleBookRevision ||
      revision.current.expected_configuration_revision !== plan.configurationRevision ||
      revision.current.expected_source_revision !== plan.sourceRevision);
  async function submit(isPreview: boolean) {
    const valid = AnnualRuleProfilesSchema.safeParse(profiles);
    if (!valid.success) {
      setMessage(valid.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      return;
    }
    if (reason.trim().length < 4) {
      setMessage('Enter a reason for this rule review.');
      return;
    }
    setBusy(true);
    setMessage('');
    const body = {
      ...(revision.current ?? expectedPlan(plan)),
      profiles: valid.data,
      preview: isPreview,
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await annualPost<Preview>(
        `annual-plan/${plan.year}/profiles`,
        body,
        pending.current.key,
      );
      if (isPreview) {
        setPreview(result);
        setMessage('Compilation succeeded. Review the resolved sources below before saving.');
      } else {
        setDraft(null);
        setReason('');
        revision.current = null;
        pending.current = null;
        setPreview(null);
        await onSaved();
        setMessage('Scoped rules saved to the designated annual rule book.');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Rule compilation failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground">
        Requirements accumulate across all matching profiles. Points and priorities use department →
        rank → station/shift → family → individual position precedence. The most specific whole
        definition applies; conflicting definitions at equal specificity block saving.
      </p>
      {saved.isError && <p role="alert">Saved profiles could not be refreshed.</p>}
      {saved.data?.ruleRevision !== null &&
        saved.data?.ruleRevision !== undefined &&
        saved.data.ruleRevision !== plan.ruleBookRevision && (
          <p className="text-warning">
            Rules changed after the last profile compilation. Review the individual edits before
            compiling these profiles again.
          </p>
        )}
      {stale && (
        <p role="alert" className="text-warning">
          The plan or source evidence changed while you were editing. Your draft is retained;
          discard and reload before applying it to a newer revision.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Label className="min-w-0 flex-1">
          Rule profile
          <NativeSelect
            className={fieldClass}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a profile</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || 'Unnamed profile'} · {p.scope.kind.replaceAll('_', ' ')}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button
          type="button"
          className={buttonClass}
          disabled={busy || plan.lifecycle !== 'DRAFT' || saved.isPending || saved.isError}
          onClick={add}
        >
          Add profile
        </Button>
        {dirty && (
          <Button
            type="button"
            className={buttonClass}
            onClick={() => {
              if (!window.confirm('Discard unsaved profile edits?')) return;
              setDraft(null);
              setReason('');
              revision.current = null;
              setPreview(null);
              onDirty(false);
            }}
          >
            Discard edits
          </Button>
        )}
      </div>
      {profile && (
        <fieldset
          disabled={busy || plan.lifecycle !== 'DRAFT'}
          className="space-y-4 rounded border border-border p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Label>
              Profile name
              <Input
                className={fieldClass}
                value={profile.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Label>
            <Label>
              Policy source reference
              <Input
                className={fieldClass}
                value={profile.sourceRef}
                onChange={(e) => patch({ sourceRef: e.target.value })}
              />
            </Label>
          </div>
          <Label className="block">
            Applies to
            <NativeSelect
              className={fieldClass}
              value={profile.scope.kind}
              onChange={(e) => {
                const kind = e.target.value;
                patch({
                  scope:
                    kind === 'department'
                      ? { kind }
                      : kind === 'rank'
                        ? { kind, rank: 'FF' }
                        : kind === 'station_shift'
                          ? { kind, station: '', shift: 'A' }
                          : kind === 'family'
                            ? { kind, name: '', positionIds: [] }
                            : { kind: 'position', positionId: '' },
                });
              }}
            >
              {['department', 'rank', 'station_shift', 'family', 'position'].map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll('_', ' ')}
                </option>
              ))}
            </NativeSelect>
          </Label>
          {profile.scope.kind === 'rank' && (
            <Label className="block">
              Rank
              <NativeSelect
                className={fieldClass}
                value={profile.scope.rank}
                onChange={(e) =>
                  patch({
                    scope: { kind: 'rank', rank: e.target.value as (typeof RULE_RANKS)[number] },
                  })
                }
              >
                {RULE_RANKS.map((rank) => (
                  <option key={rank}>{rank}</option>
                ))}
              </NativeSelect>
            </Label>
          )}
          {profile.scope.kind === 'station_shift' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Label>
                Station or group
                <NativeSelect
                  className={fieldClass}
                  value={profile.scope.station}
                  onChange={(e) => {
                    if (profile.scope.kind === 'station_shift')
                      patch({ scope: { ...profile.scope, station: e.target.value } });
                  }}
                >
                  <option value="">Choose a station</option>
                  {[...new Set(board.data?.map((p) => p.station) ?? [])].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </NativeSelect>
              </Label>
              <Label>
                Shift
                <NativeSelect
                  className={fieldClass}
                  value={profile.scope.shift}
                  onChange={(e) => {
                    if (profile.scope.kind === 'station_shift')
                      patch({
                        scope: { ...profile.scope, shift: e.target.value as 'A' | 'B' | 'C' | 'D' },
                      });
                  }}
                >
                  {['A', 'B', 'C', 'D'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </NativeSelect>
              </Label>
            </div>
          )}
          {profile.scope.kind === 'family' && (
            <Label className="block">
              Family or specialty name
              <Input
                className={fieldClass}
                value={profile.scope.name}
                onChange={(e) => {
                  if (profile.scope.kind === 'family')
                    patch({ scope: { ...profile.scope, name: e.target.value } });
                }}
              />
            </Label>
          )}
          {(profile.scope.kind === 'family' || profile.scope.kind === 'position') && (
            <Label className="block">
              {profile.scope.kind === 'family'
                ? 'Explicit family positions'
                : 'Individual position'}
              <NativeSelect
                multiple={profile.scope.kind === 'family'}
                className={`${fieldClass} ${profile.scope.kind === 'family' ? 'min-h-32' : ''}`}
                value={
                  profile.scope.kind === 'family'
                    ? profile.scope.positionIds
                    : profile.scope.positionId
                }
                onChange={(e) => {
                  if (profile.scope.kind === 'family')
                    patch({
                      scope: {
                        ...profile.scope,
                        positionIds: Array.from(e.target.selectedOptions, (o) => o.value),
                      },
                    });
                  else patch({ scope: { kind: 'position', positionId: e.target.value } });
                }}
              >
                {profile.scope.kind === 'position' && <option value="">Choose position</option>}
                {board.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.station} · {p.position} · {p.id}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          )}
          <Label className="block">
            Required qualifications (all selected)
            <NativeSelect
              multiple
              className={`${fieldClass} min-h-32`}
              value={profile.requirements.credentials}
              onChange={(e) =>
                patch({
                  requirements: {
                    ...profile.requirements,
                    credentials: Array.from(e.target.selectedOptions, (o) => o.value),
                  },
                })
              }
            >
              {catalog.data
                ?.filter((c) => !c.retiredOn)
                .map((c) => (
                  <option key={c.id} value={c.policyName ?? c.name}>
                    {c.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <QualificationAlternativesEditor
            value={profile.requirements.anyOfCredentials ?? []}
            onChange={(anyOfCredentials) =>
              patch({ requirements: { ...profile.requirements, anyOfCredentials } })
            }
          />
          <ServiceRequirementsEditor
            value={profile.requirements.service ?? []}
            onChange={(service) => patch({ requirements: { ...profile.requirements, service } })}
          />
          <PostAwardObligationsEditor
            value={profile.requirements.postAward ?? []}
            onChange={(postAward) =>
              patch({ requirements: { ...profile.requirements, postAward } })
            }
          />
          <div className="flex flex-wrap gap-4">
            {RULE_CUSTOM_CRITERIA.map((gate) => (
              <Label key={gate} className="flex min-h-11 items-center gap-2">
                <Input
                  type="checkbox"
                  checked={profile.requirements.custom.includes(gate)}
                  onChange={(e) =>
                    patch({
                      requirements: {
                        ...profile.requirements,
                        custom: e.target.checked
                          ? [...profile.requirements.custom, gate]
                          : profile.requirements.custom.filter((g) => g !== gate),
                      },
                    })
                  }
                />
                {gate.replaceAll('_', ' ')}
              </Label>
            ))}
          </div>
          <Label className="flex min-h-11 items-center gap-2">
            <Input
              type="checkbox"
              checked={profile.scoring !== undefined}
              onChange={(e) =>
                patch({
                  scoring: e.target.checked ? { v: 1, total: [], so: [], mo: [] } : undefined,
                })
              }
            />
            Define all three points channels at this scope
          </Label>
          {profile.scoring && (
            <ConfiguredScoringEditor
              value={profile.scoring}
              onChange={(scoring) => patch({ scoring })}
            />
          )}
          <Label className="flex min-h-11 items-center gap-2">
            <Input
              type="checkbox"
              checked={profile.tieBreakChain !== undefined}
              onChange={(e) => patch({ tieBreakChain: e.target.checked ? [] : undefined })}
            />
            Define ranking priority at this scope
          </Label>
          {profile.tieBreakChain && (
            <div className="space-y-2">
              {profile.tieBreakChain.map((key, index) => (
                <div className="flex items-end gap-2" key={`${index}:${key}`}>
                  <Label className="min-w-0 flex-1">
                    Priority {index + 1}
                    <NativeSelect
                      className={fieldClass}
                      value={key}
                      onChange={(e) =>
                        patch({
                          tieBreakChain: profile.tieBreakChain?.map((v, i) =>
                            i === index
                              ? (e.target.value as (typeof RULE_TIE_BREAK_KEYS)[number])
                              : v,
                          ),
                        })
                      }
                    >
                      {RULE_TIE_BREAK_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {k.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Button
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      patch({ tieBreakChain: profile.tieBreakChain?.filter((_, i) => i !== index) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                className={buttonClass}
                disabled={profile.tieBreakChain.length >= 5}
                onClick={() =>
                  patch({
                    tieBreakChain: [
                      ...(profile.tieBreakChain ?? []),
                      RULE_TIE_BREAK_KEYS.find((k) => !profile.tieBreakChain?.includes(k)) ??
                        'rsc_seniority',
                    ],
                  })
                }
              >
                Add priority
              </Button>
            </div>
          )}
          <Button
            type="button"
            className={buttonClass}
            onClick={() => {
              if (window.confirm('Remove this profile from the draft?')) {
                change(profiles.filter((p) => p.id !== profile.id));
                setSelected('');
              }
            }}
          >
            Remove profile
          </Button>
        </fieldset>
      )}
      <Label className="block">
        Reason for this rule review
        <Input
          className={fieldClass}
          value={reason}
          onChange={(e) => {
            if (!revision.current) revision.current = expectedPlan(plan);
            setReason(e.target.value);
            onDirty(true);
            setPreview(null);
          }}
        />
      </Label>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className={buttonClass}
          disabled={busy || stale || !profiles.length || plan.lifecycle !== 'DRAFT'}
          onClick={() => void submit(true)}
        >
          Preview resolved rules
        </Button>
        <Button
          type="button"
          className={buttonClass}
          disabled={busy || stale || !preview || plan.lifecycle !== 'DRAFT'}
          onClick={() => void submit(false)}
        >
          Save reviewed rules
        </Button>
      </div>
      {message && (
        <output className="block whitespace-pre-wrap rounded border border-border p-3">
          {message}
        </output>
      )}
      {preview && (
        <div className="space-y-3">
          <h3 className="font-semibold">Resolved rules ({preview.compiled.length})</h3>
          {preview.compiled.map((p) => (
            <details className="rounded border border-border p-3" key={p.rule.positionId}>
              <summary>{p.rule.positionId}</summary>
              {(['requirements', 'scoring', 'priorities'] as const).map((field) => (
                <p className="mt-2 text-sm" key={field}>
                  {field}:{' '}
                  {p.provenance[field]
                    .map((id) => profiles.find((p) => p.id === id)?.name ?? id)
                    .join(', ') || 'Position rank only'}
                </p>
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
