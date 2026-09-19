'use client';

import { ConfiguredScoringEditor } from '@/app/admin/positions/[id]/edit/ConfiguredScoringEditor';
import { PostAwardObligationsEditor } from '@/components/admin/PostAwardObligationsEditor';
import { QualificationAlternativesEditor } from '@/components/admin/QualificationAlternativesEditor';
import { ServiceRequirementsEditor } from '@/components/admin/ServiceRequirementsEditor';
import { Button } from '@/components/ui/button';
import { useCredentialCatalog } from '@/lib/use-credential-catalog';
import {
  type BidDefinitionContent,
  type ConfiguredScoring,
  type PostAwardObligation,
  RULE_CUSTOM_CRITERIA,
  RULE_RANKS,
  RULE_TIE_BREAK_KEYS,
} from '@mbfd/shared';
import { useState } from 'react';
import {
  CheckField,
  ChoiceField,
  FieldSection,
  OrderedChoices,
  ReferencePicker,
  TextField,
} from './BidFields';

type Profile = NonNullable<BidDefinitionContent['authoring']>['profiles'][number];
type Scope = Profile['scope'];

const scopeOptions: readonly { value: Scope['kind']; label: string }[] = [
  { value: 'department', label: 'All Bid opportunities' },
  { value: 'rank', label: 'Opportunity rank' },
  { value: 'station_shift', label: 'Station and shift' },
  { value: 'family', label: 'Named family with explicit opportunities' },
  { value: 'position', label: 'One opportunity' },
];
const tieLabels: Record<(typeof RULE_TIE_BREAK_KEYS)[number], string> = {
  points: 'Total points',
  so_points: 'Special Operations points',
  mo_points: 'Marine Operations points',
  rsc_seniority: 'RSC seniority',
  rank_seniority: 'Rank seniority',
};

function emptyScope(kind: Scope['kind']): Scope {
  switch (kind) {
    case 'department':
      return { kind };
    case 'rank':
      return { kind, rank: 'FF' };
    case 'station_shift':
      return { kind, station: '', shift: 'A' };
    case 'family':
      return { kind, name: '', positionIds: [] };
    case 'position':
      return { kind, positionId: '' };
  }
}

function newProfile(scope: Scope = { kind: 'department' }): Profile {
  return {
    id: crypto.randomUUID(),
    name: '',
    sourceRef: '',
    scope,
    requirements: { credentials: [], custom: [] },
  };
}

function profileLabel(profile: Profile) {
  return `${profile.name || 'Unnamed shared rule'} · ${
    scopeOptions.find((option) => option.value === profile.scope.kind)?.label ?? profile.scope.kind
  }`;
}

function positionLabel(position: BidDefinitionContent['positions'][number]) {
  return `${position.positionName || 'Name required'} · ${position.shift} shift · ${position.station} · ${position.id}`;
}

/**
 * Draft-only profile authoring. It deliberately does not decide who matches,
 * calculate scores, infer a family, or materialize direct rules. The server's
 * profile-review response is the sole authority for those results.
 */
export function BidRuleProfiles({
  content,
  selectedPositionId,
  onChange,
}: {
  content: BidDefinitionContent;
  selectedPositionId: string | null;
  onChange(content: BidDefinitionContent): void;
}) {
  const catalog = useCredentialCatalog();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    content.authoring?.profiles[0]?.id ?? null,
  );
  const profiles = content.authoring?.profiles ?? [];
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const selectedPosition = content.positions.find((position) => position.id === selectedPositionId);
  const positionOptions = content.positions.map((position) => ({
    value: position.id,
    label: positionLabel(position),
  }));
  const qualificationOptions = (catalog.data ?? []).map((credential) => ({
    value: credential.policyName ?? credential.name,
    label: `${credential.name}${credential.retiredOn ? ' · Retired' : ''}`,
  }));

  const changeProfiles = (next: Profile[]) => {
    onChange({
      ...content,
      authoring: next.length
        ? {
            profiles: next,
            // A profile change makes any prior materialization stale. Retaining it would make
            // browser UI appear authoritative and can leave provenance pointing at deleted ids.
            compiled: [],
            reconciliation: 'PROFILE_EDITS_PENDING_REVIEW',
          }
        : null,
    });
  };
  const patch = (update: Partial<Profile>) => {
    if (!selectedProfile) return;
    changeProfiles(
      profiles.map((profile) =>
        profile.id === selectedProfile.id ? { ...profile, ...update } : profile,
      ),
    );
  };
  const patchRequirements = (update: Partial<Profile['requirements']>) => {
    if (!selectedProfile) return;
    patch({ requirements: { ...selectedProfile.requirements, ...update } });
  };
  const addProfile = (scope?: Scope) => {
    const profile = newProfile(scope);
    changeProfiles([...profiles, profile]);
    setSelectedProfileId(profile.id);
  };

  return (
    <FieldSection
      title="Shared requirements & points"
      description="Set requirements and points once for related opportunities. Save applies shared rules, while optional review shows which positions and candidates will be affected."
    >
      <div className="flex flex-wrap gap-3" data-testid="bid-rule-profiles">
        <Button type="button" onClick={() => addProfile()}>
          Add shared rule profile
        </Button>
        {selectedPosition && (
          <Button
            type="button"
            onClick={() => addProfile({ kind: 'position', positionId: selectedPosition.id })}
          >
            Create position-specific override
          </Button>
        )}
      </div>
      {content.authoring?.reconciliation === 'PROFILE_EDITS_PENDING_REVIEW' && (
        <output className="block text-sm text-warning">
          Shared-rule edits will be checked and applied when you save.
        </output>
      )}
      {content.authoring?.reconciliation === 'RULES_CHANGED_AFTER_COMPILATION' && (
        <p className="text-sm text-warning">
          Individual opportunity rules override the last shared-rule compilation. Editing a shared
          profile will replace those individual rules when you save; review its impact first.
        </p>
      )}
      {catalog.isError && (
        <p role="alert" className="text-sm text-warning">
          Qualification catalog unavailable. Saved selections remain visible.
        </p>
      )}
      {profiles.length > 0 && (
        <div className="grid min-w-0 gap-2 md:grid-cols-2" aria-label="Shared rule profiles">
          {profiles.map((profile) => (
            <Button
              type="button"
              key={profile.id}
              aria-pressed={profile.id === selectedProfile?.id}
              className={`justify-start text-left ${
                profile.id === selectedProfile?.id ? 'border-primary bg-accent' : ''
              }`}
              onClick={() => setSelectedProfileId(profile.id)}
            >
              {profileLabel(profile)}
            </Button>
          ))}
        </div>
      )}
      {!profiles.length && (
        <p className="text-sm text-muted-foreground">
          Add a shared rule profile for requirements or points that apply beyond one opportunity.
          Existing position rules remain unchanged until a reviewed materialization is applied.
        </p>
      )}
      {selectedProfile && (
        <div className="space-y-4 rounded border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Profile name"
              value={selectedProfile.name}
              onChange={(name) => patch({ name })}
            />
            <TextField
              label="Policy source reference"
              value={selectedProfile.sourceRef}
              onChange={(sourceRef) => patch({ sourceRef })}
              help="Cite the approved source for this profile. A profile name is not an authority."
            />
          </div>
          <ChoiceField
            label="Applies to"
            value={selectedProfile.scope.kind}
            options={scopeOptions}
            onChange={(kind) => patch({ scope: emptyScope(kind) })}
          />
          {selectedProfile.scope.kind === 'rank' && (
            <ChoiceField
              label="Opportunity rank"
              value={selectedProfile.scope.rank}
              options={RULE_RANKS.map((rank) => ({ value: rank, label: rank }))}
              onChange={(rank) => patch({ scope: { kind: 'rank', rank } })}
            />
          )}
          {selectedProfile.scope.kind === 'station_shift' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Station"
                value={selectedProfile.scope.station}
                onChange={(station) =>
                  selectedProfile.scope.kind === 'station_shift' &&
                  patch({ scope: { ...selectedProfile.scope, station } })
                }
              />
              <ChoiceField
                label="Shift"
                value={selectedProfile.scope.shift}
                options={(['A', 'B', 'C', 'D'] as const).map((shift) => ({
                  value: shift,
                  label: shift,
                }))}
                onChange={(shift) =>
                  selectedProfile.scope.kind === 'station_shift' &&
                  patch({ scope: { ...selectedProfile.scope, shift } })
                }
              />
            </div>
          )}
          {selectedProfile.scope.kind === 'family' && (
            <>
              <TextField
                label="Family name"
                value={selectedProfile.scope.name}
                onChange={(name) =>
                  selectedProfile.scope.kind === 'family' &&
                  patch({ scope: { ...selectedProfile.scope, name } })
                }
                help="This is a label for the explicitly selected opportunities; it never discovers members."
              />
              <ReferencePicker
                label="Family positions (explicit)"
                values={selectedProfile.scope.positionIds}
                options={positionOptions}
                onChange={(positionIds) =>
                  selectedProfile.scope.kind === 'family' &&
                  patch({ scope: { ...selectedProfile.scope, positionIds } })
                }
                help="Choose every opportunity in this family. Search and paging never remove saved selections."
              />
            </>
          )}
          {selectedProfile.scope.kind === 'position' && (
            <ReferencePicker
              label="Individual opportunity"
              values={selectedProfile.scope.positionId ? [selectedProfile.scope.positionId] : []}
              options={positionOptions}
              onChange={(positionIds) =>
                patch({
                  scope: { kind: 'position', positionId: positionIds.at(-1) ?? '' },
                })
              }
              help="A position-specific profile is an explicit override. It does not infer a broader family."
            />
          )}
          <FieldSection
            title="Requirements"
            description="Required rank is separate from the profile scope. Requirements accumulate only when the Bid service confirms a matching position."
          >
            <ReferencePicker
              label="Required rank(s)"
              values={selectedProfile.requirements.ranks ?? []}
              options={RULE_RANKS.map((rank) => ({ value: rank, label: rank }))}
              onChange={(ranks) =>
                patchRequirements({
                  ranks: ranks.length ? (ranks as Profile['requirements']['ranks']) : undefined,
                })
              }
              help="Leave this empty when the source specifies no extra rank requirement. This does not change who the profile applies to."
            />
            <ReferencePicker
              label="Required qualifications"
              values={selectedProfile.requirements.credentials}
              options={qualificationOptions}
              onChange={(credentials) => patchRequirements({ credentials })}
            />
            <QualificationAlternativesEditor
              value={selectedProfile.requirements.anyOfCredentials ?? []}
              onChange={(anyOfCredentials) => patchRequirements({ anyOfCredentials })}
            />
            <ServiceRequirementsEditor
              value={selectedProfile.requirements.service ?? []}
              onChange={(service) => patchRequirements({ service })}
            />
            <PostAwardObligationsEditor
              value={(selectedProfile.requirements.postAward ?? []) as PostAwardObligation[]}
              onChange={(postAward) => patchRequirements({ postAward })}
            />
            <ReferencePicker
              label="Additional requirements"
              values={selectedProfile.requirements.custom}
              options={RULE_CUSTOM_CRITERIA.map((value) => ({
                value,
                label: value.replaceAll('_', ' '),
              }))}
              onChange={(custom) =>
                patchRequirements({ custom: custom as Profile['requirements']['custom'] })
              }
            />
          </FieldSection>
          <FieldSection
            title="Credentials & points"
            description="Points, caps and prerequisites are edited with the existing scoring controls. The Bid service, not this browser, evaluates them."
          >
            <CheckField
              label="Set qualifications, caps and points for this profile"
              value={selectedProfile.scoring !== undefined}
              onChange={(enabled) =>
                patch({
                  scoring: enabled
                    ? ({ v: 1, total: [], so: [], mo: [] } as ConfiguredScoring)
                    : undefined,
                })
              }
            />
            {selectedProfile.scoring !== undefined && (
              <ConfiguredScoringEditor
                value={selectedProfile.scoring}
                onChange={(scoring) => patch({ scoring })}
              />
            )}
          </FieldSection>
          <FieldSection
            title="Candidate ranking"
            description="A profile can provide an explicit ranking chain. No default chain is assumed; the server blocks materialization if a concrete rule cannot be resolved safely."
          >
            <CheckField
              label="Set a ranking chain for this profile"
              value={selectedProfile.tieBreakChain !== undefined}
              onChange={(enabled) => patch({ tieBreakChain: enabled ? [] : undefined })}
            />
            {selectedProfile.tieBreakChain !== undefined && (
              <OrderedChoices
                label="Candidate ranking priority"
                values={selectedProfile.tieBreakChain}
                options={RULE_TIE_BREAK_KEYS.map((value) => ({ value, label: tieLabels[value] }))}
                onChange={(tieBreakChain) => patch({ tieBreakChain })}
              />
            )}
          </FieldSection>
          <Button
            type="button"
            onClick={() => {
              changeProfiles(profiles.filter((profile) => profile.id !== selectedProfile.id));
              setSelectedProfileId(null);
            }}
          >
            {profiles.length === 1
              ? 'Remove sharing and keep opportunity rules'
              : 'Remove shared rule profile'}
          </Button>
        </div>
      )}
    </FieldSection>
  );
}
