'use client';
import { WorkingDraftPanel } from '@/components/admin/WorkingDraftPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { type ConfiguredScoring, FrozenLiveBidPolicySchema } from '@mbfd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ConfiguredScoringEditor } from '../positions/[id]/edit/ConfiguredScoringEditor';
import { AnnualPolicyPublishGate } from './AnnualPolicyPublishGate';

export interface AnnualPolicyDocument {
  id: string;
  rule_book_version: string;
  effective_year: number;
  revision: number;
  status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  policy_text: string;
  execution_policy: unknown;
  supersedes_document_id: string | null;
  published_at: number | null;
}

interface Props {
  year: number;
  documents: AnnualPolicyDocument[];
  loadError: string | null;
}

type StageKind = 'D_SHIFT' | 'CAPTAIN' | 'LIEUTENANT' | 'FIREFIGHTER' | 'MIXED';
type TimingMode = 'HARD_MINIMUM' | 'TARGET' | 'OPERATOR_DISCRETION';
type SourceMember = {
  member_id: number;
  first_name: string;
  last_name: string;
  rank: string;
  pool: 'OFC' | 'FF' | 'EXCLUDED';
  rsc_seniority: number;
  rank_seniority: number | null;
  credential_names: string[];
  specialty_qualification_codes: string[];
};
type SourcePosition = {
  id: string;
  shift: 'A' | 'B' | 'C' | 'D';
  station: string;
  unit: string;
  rank_required: string;
  position_name: string;
};
type EditorSource = {
  rule_book_version: string;
  configuration_revision: number;
  rule_book_revision: number;
  source_revision: number;
  managed_annual_plan: boolean;
  credential_evaluation_on: string;
  members: SourceMember[];
  positions: SourcePosition[];
};
type Stage = {
  key: string;
  id: string;
  label: string;
  kind: StageKind;
  memberIds: number[];
  positionIds: string[];
};
type DispositionName = 'HOLD' | 'PASS' | 'DEFER' | 'SKIP' | 'DECLINED' | 'UNREACHABLE';
type Disposition = {
  configured: boolean;
  advances: boolean;
  returns: boolean;
  returnStageId: string;
  retainsLaterSelectionRights: boolean;
  terminal: boolean;
  requiresReason: boolean;
  requiresEvidence: boolean;
  contactPolicyReference: string;
};
type Specialty = {
  key: string;
  id: string;
  label: string;
  mode: 'INTERRUPTING' | 'PRIORITY_ONLY';
  positionIds: string[];
  credentials: string;
  qualifications: string;
  points: string;
  scoring?: ConfiguredScoring;
  rankingChannel?: 'total' | 'so' | 'mo' | undefined;
  tieBreak: string;
};

const actions = [
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  'approve_transition',
  'approve_final_results',
  'publish',
] as const;
const dispositionNames: DispositionName[] = [
  'HOLD',
  'PASS',
  'DEFER',
  'SKIP',
  'DECLINED',
  'UNREACHABLE',
];
const stageKinds: StageKind[] = ['D_SHIFT', 'CAPTAIN', 'LIEUTENANT', 'FIREFIGHTER', 'MIXED'];

function emptyDisposition(): Disposition {
  return {
    configured: false,
    advances: false,
    returns: false,
    returnStageId: '',
    retainsLaterSelectionRights: false,
    terminal: false,
    requiresReason: false,
    requiresEvidence: false,
    contactPolicyReference: '',
  };
}

function workerError(value: unknown, fallback: string): string {
  return typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : fallback;
}

function selected(target: HTMLSelectElement): string[] {
  return [...target.selectedOptions].map((option) => option.value);
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const inputClass =
  'mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground';

export function AnnualPolicyWorkspace({ year, documents, loadError }: Props) {
  const router = useRouter();
  const client = useQueryClient();
  const pendingWrite = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingPublication = useRef<{ fingerprint: string; key: string } | null>(null);
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [source, setSource] = useState<EditorSource | null>(null);
  const [language, setLanguage] = useState('');
  const [policyRevision, setPolicyRevision] = useState('');
  const [stages, setStages] = useState<Stage[]>([]);
  const [permissions, setPermissions] = useState<Record<(typeof actions)[number], number[]>>(
    Object.fromEntries(actions.map((action) => [action, []])) as unknown as Record<
      (typeof actions)[number],
      number[]
    >,
  );
  const [dispositions, setDispositions] = useState<Record<DispositionName, Disposition>>(
    Object.fromEntries(dispositionNames.map((name) => [name, emptyDisposition()])) as Record<
      DispositionName,
      Disposition
    >,
  );
  const [minimumAttempts, setMinimumAttempts] = useState('');
  const [timingMode, setTimingMode] = useState<TimingMode>('OPERATOR_DISCRETION');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [contactEvidenceRequired, setContactEvidenceRequired] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [aDay, setADay] = useState({
    min: '',
    max: '',
    captainDcMax: '',
    marineAssigned: '',
    marineFloat: '',
    de: '',
    swat: '',
  });
  const [refs, setRefs] = useState({ specialty: '', aDay: '', transition: '', publication: '' });
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const formState = {
    language,
    policyRevision,
    stages,
    permissions,
    dispositions,
    minimumAttempts,
    timingMode,
    durationSeconds,
    contactEvidenceRequired,
    specialties,
    aDay,
    refs,
    reason,
  };
  const formFingerprint = JSON.stringify(formState);
  const [savedFingerprint, setSavedFingerprint] = useState(formFingerprint);
  useUnsavedChanges(savedFingerprint !== formFingerprint, 'annual operating policy');
  const sourceQuery = useQuery({
    queryKey: ['admin', 'annual-policy', year, 'editor-data'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/admin/annual-policy-documents/${year}/editor-data`, {
        credentials: 'include',
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(workerError(body, `Source service returned ${response.status}.`));
      return body as EditorSource;
    },
  });
  const sourceError = sourceQuery.error instanceof Error ? sourceQuery.error.message : null;
  useEffect(() => {
    if (sourceQuery.data) setSource((current) => current ?? sourceQuery.data ?? null);
  }, [sourceQuery.data]);
  const sourceChanged =
    !!source &&
    !!sourceQuery.data &&
    (source.configuration_revision !== sourceQuery.data.configuration_revision ||
      source.rule_book_revision !== sourceQuery.data.rule_book_revision ||
      source.source_revision !== sourceQuery.data.source_revision);

  const allMembers = source?.members ?? [];
  const participants = allMembers.filter((member) => member.pool !== 'EXCLUDED');
  const ready = useMemo(() => {
    const stagedIds = stages.flatMap((stage) => stage.memberIds);
    const staged = new Set(stagedIds);
    return (
      source !== null &&
      stages.length > 0 &&
      stagedIds.length === participants.length &&
      staged.size === participants.length &&
      participants.every((member) => staged.has(member.member_id)) &&
      stages.every(
        (stage) =>
          stage.id.trim() &&
          stage.label.trim() &&
          stage.memberIds.length > 0 &&
          stage.positionIds.length > 0,
      ) &&
      actions.every((action) => permissions[action].length > 0) &&
      dispositionNames.every(
        (name) =>
          dispositions[name].configured &&
          (!dispositions[name].returns || dispositions[name].returnStageId !== ''),
      ) &&
      language.trim().length >= 20 &&
      policyRevision.trim().length > 0 &&
      Number(minimumAttempts) >= 1 &&
      (timingMode === 'OPERATOR_DISCRETION' || durationSeconds !== '') &&
      specialties.length > 0 &&
      specialties.every(
        (specialty) =>
          specialty.id.trim() &&
          specialty.label.trim() &&
          specialty.positionIds.length > 0 &&
          csv(specialty.tieBreak).length > 0,
      ) &&
      Object.values(aDay).every(Boolean) &&
      Object.values(refs).every((value) => value.trim()) &&
      reason.trim().length >= 4
    );
  }, [
    aDay,
    dispositions,
    durationSeconds,
    language,
    minimumAttempts,
    participants,
    permissions,
    policyRevision,
    reason,
    refs,
    source,
    specialties,
    stages,
    timingMode,
  ]);

  function updateStage(key: string, patch: Partial<Stage>) {
    setStages((current) =>
      current.map((stage) => (stage.key === key ? { ...stage, ...patch } : stage)),
    );
  }

  function moveStage(index: number, offset: number) {
    setStages((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      if (item) copy.splice(target, 0, item);
      return copy;
    });
  }

  function loadRevision(document: AnnualPolicyDocument) {
    const parsed = FrozenLiveBidPolicySchema.safeParse(document.execution_policy);
    const policy = parsed.success ? parsed.data : null;
    const annual = policy?.annualOperations;
    if (policy === null || annual === undefined) {
      setMessage({
        kind: 'error',
        text: 'This historical revision cannot be edited in the annual no-code editor.',
      });
      return;
    }
    setLanguage(document.policy_text);
    setPolicyRevision('');
    setStages(
      policy.stages.map((stage) => ({
        key: crypto.randomUUID(),
        id: stage.id,
        label: stage.label,
        kind: stage.kind,
        memberIds: [...stage.memberIds],
        positionIds: [...stage.opportunityPositionIds],
      })),
    );
    setPermissions(
      Object.fromEntries(
        actions.map((action) => [
          action,
          [
            ...(policy.actionPermissions.find((entry) => entry.action === action)?.actorMemberIds ??
              []),
          ],
        ]),
      ) as Record<(typeof actions)[number], number[]>,
    );
    setDispositions(
      Object.fromEntries(
        dispositionNames.map((name) => {
          const rule = policy.dispositions.find((entry) => entry.disposition === name);
          return [
            name,
            rule === undefined
              ? emptyDisposition()
              : {
                  configured: true,
                  advances: rule.advances,
                  returns: rule.returns,
                  returnStageId: rule.returnStageId ?? '',
                  retainsLaterSelectionRights: rule.retainsLaterSelectionRights,
                  terminal: rule.terminal,
                  requiresReason: rule.requiresReason,
                  requiresEvidence: rule.requiresEvidence,
                  contactPolicyReference: rule.contactPolicyReference ?? '',
                },
          ];
        }),
      ) as Record<DispositionName, Disposition>,
    );
    setMinimumAttempts(String(annual.contact.minimumAttempts));
    setTimingMode(annual.contact.timingMode);
    setDurationSeconds(
      annual.contact.durationSeconds === null ? '' : String(annual.contact.durationSeconds),
    );
    setContactEvidenceRequired(annual.contact.evidenceRequired ?? false);
    setSpecialties(
      (annual.specialties ?? []).map((specialty) => ({
        key: crypto.randomUUID(),
        id: specialty.id,
        label: specialty.label,
        mode: specialty.mode,
        positionIds: [...specialty.opportunityPositionIds],
        credentials: specialty.requiredCredentialNames.join(', '),
        qualifications: specialty.requiredSpecialtyCodes.join(', '),
        points: specialty.points
          .map((point) => `${point.credentialName}:${point.value}`)
          .join(', '),
        tieBreak: specialty.tieBreakChain.join(', '),
        ...(specialty.scoring
          ? { scoring: specialty.scoring, rankingChannel: specialty.rankingChannel }
          : {}),
      })),
    );
    setADay({
      min: String(annual.aDay.min),
      max: String(annual.aDay.max),
      captainDcMax: String(annual.aDay.captainDcMax),
      marineAssigned: String(annual.aDay.specialtyMaximums.MARINE_ASSIGNED),
      marineFloat: String(annual.aDay.specialtyMaximums.MARINE_FLOAT),
      de: String(annual.aDay.specialtyMaximums.DE),
      swat: String(annual.aDay.specialtyMaximums.SWAT),
    });
    setRefs({
      specialty: policy.specialtyCatalogReference ?? '',
      aDay: policy.aDayPolicyReference ?? '',
      transition: policy.transitionPolicyReference ?? '',
      publication: policy.publicationPolicyReference ?? '',
    });
    setReason('');
    setMessage({
      kind: 'success',
      text: `Revision ${document.revision} loaded. Enter a new executable revision and reason before saving.`,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function executionPolicy() {
    return {
      v: 1,
      policyRevision: policyRevision.trim(),
      stages: stages.map((stage, order) => ({
        id: stage.id.trim(),
        label: stage.label.trim(),
        order,
        memberIds: stage.memberIds,
        opportunityPositionIds: stage.positionIds,
        kind: stage.kind,
      })),
      dispositions: dispositionNames.map((name) => {
        const rule = dispositions[name];
        return {
          disposition: name,
          advances: rule.advances,
          returns: rule.returns,
          returnStageId: rule.returns ? rule.returnStageId : null,
          retainsLaterSelectionRights: rule.retainsLaterSelectionRights,
          terminal: rule.terminal,
          requiresReason: rule.requiresReason,
          requiresEvidence: rule.requiresEvidence,
          contactPolicyReference: rule.contactPolicyReference.trim() || null,
        };
      }),
      actionPermissions: actions.map((action) => ({ action, actorMemberIds: permissions[action] })),
      specialtyCatalogReference: refs.specialty.trim(),
      aDayPolicyReference: refs.aDay.trim(),
      transitionPolicyReference: refs.transition.trim(),
      publicationPolicyReference: refs.publication.trim(),
      annualOperations: {
        v: 1,
        stageOrder: stages.map((stage) => stage.id.trim()),
        requiredTopologyPositionIds: [
          ...new Set(specialties.flatMap((specialty) => specialty.positionIds)),
        ],
        specialties: specialties.map((specialty) => ({
          id: specialty.id.trim(),
          label: specialty.label.trim(),
          mode: specialty.mode,
          opportunityPositionIds: specialty.positionIds,
          requiredCredentialNames: csv(specialty.credentials),
          requiredSpecialtyCodes: csv(specialty.qualifications),
          points: specialty.scoring
            ? []
            : csv(specialty.points).map((item) => {
                const [credentialName = '', rawValue = ''] = item
                  .split(':')
                  .map((part) => part.trim());
                return { credentialName, value: Number(rawValue) };
              }),
          tieBreakChain: csv(specialty.tieBreak),
          ...(specialty.scoring
            ? { scoring: specialty.scoring, rankingChannel: specialty.rankingChannel }
            : {}),
        })),
        contact: {
          minimumAttempts: Number(minimumAttempts),
          timingMode,
          durationSeconds: timingMode === 'OPERATOR_DISCRETION' ? null : Number(durationSeconds),
          evidenceRequired: contactEvidenceRequired,
        },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: Number(aDay.min),
          max: Number(aDay.max),
          captainDcMax: Number(aDay.captainDcMax),
          specialtyMaximums: {
            MARINE_ASSIGNED: Number(aDay.marineAssigned),
            MARINE_FLOAT: Number(aDay.marineFloat),
            DE: Number(aDay.de),
            SWAT: Number(aDay.swat),
          },
        },
      },
    };
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || source === null) {
      setMessage({
        kind: 'error',
        text: 'Policy is NOT CONFIGURED. Resolve every blocking section.',
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    const requestBody = {
      rule_book_version: source.rule_book_version,
      policy_text: language.trim(),
      execution_policy: executionPolicy(),
      reason: reason.trim(),
      expected_configuration_revision: source.configuration_revision,
      expected_rule_book_revision: source.rule_book_revision,
      expected_source_revision: source.source_revision,
    };
    const fingerprint = JSON.stringify(requestBody);
    if (pendingWrite.current?.fingerprint !== fingerprint)
      pendingWrite.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await csrfFetch(`/api/admin/annual-policy-documents/${year}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pendingWrite.current.key,
        },
        body: fingerprint,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(workerError(body, `Draft creation failed (${response.status}).`));
      setMessage({ kind: 'success', text: 'Draft saved and bound for mock verification.' });
      pendingWrite.current = null;
      setSavedFingerprint(formFingerprint);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'annual-policy'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
        invalidateWorkingBidBoards(client, ['upcoming']),
      ]);
      const refreshed = await sourceQuery.refetch();
      if (refreshed.data) setSource(refreshed.data);
      router.refresh();
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Draft creation failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function publish(document: AnnualPolicyDocument, publishReason: string): Promise<boolean> {
    if (!source) return false;
    setBusy(true);
    setMessage(null);
    const payload = {
      reason: publishReason,
      expected_configuration_revision: source.configuration_revision,
      expected_document_revision: document.revision,
    };
    const fingerprint = JSON.stringify({ documentId: document.id, payload });
    if (pendingPublication.current?.fingerprint !== fingerprint)
      pendingPublication.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const response = await csrfFetch(
        `/api/admin/annual-policy-documents/${year}/${document.id}/publish`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': pendingPublication.current.key,
          },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(workerError(body, `Publication failed (${response.status}).`));
      setMessage({ kind: 'success', text: `Revision ${document.revision} published.` });
      pendingPublication.current = null;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'annual-policy'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
      ]);
      router.refresh();
      return true;
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Publication failed.',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6" data-testid="annual-policy-editor">
      {sourceChanged && (
        <aside className="rounded border border-warning/40 p-4 text-warning">
          <p>
            Annual source data changed while this draft was open. Your policy edits are retained.
            Review the refreshed members and seats before saving.
          </p>
          <Button
            type="button"
            className="mt-3 min-h-11 rounded border px-3"
            disabled={busy}
            onClick={() => {
              if (sourceQuery.data) setSource(sourceQuery.data);
            }}
          >
            Review refreshed source
          </Button>
        </aside>
      )}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
            Annual policy authority
          </p>
          <h1 className="mt-1 font-heading text-3xl text-foreground">Executable policy — {year}</h1>
          <p className="mt-2 max-w-3xl text-sm text-foreground">
            Select real frozen members and positions. Unapproved rules remain visibly blocking.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-bold ${ready ? 'border-success/40 text-success' : 'border-warning/40 text-warning'}`}
        >
          {ready
            ? 'READY TO SAVE DRAFT'
            : 'EDITING FORM INCOMPLETE — saved policy history is shown below'}
        </span>
      </header>
      {loadError || sourceError ? (
        <p className="rounded border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
          {loadError ?? sourceError}
        </p>
      ) : null}

      <WorkingDraftPanel
        draftKey={`annual-policy:${year}`}
        value={{ ...formState, source }}
        dirty={savedFingerprint !== formFingerprint}
        onRestore={(draft) => {
          if (
            !Array.isArray(draft.stages) ||
            !Array.isArray(draft.specialties) ||
            !draft.dispositions ||
            !draft.permissions ||
            !draft.aDay ||
            !draft.refs ||
            typeof draft.language !== 'string'
          )
            throw new Error('Invalid saved draft');
          setLanguage(draft.language);
          setPolicyRevision(draft.policyRevision);
          setStages(draft.stages);
          setPermissions(draft.permissions);
          setDispositions(draft.dispositions);
          setMinimumAttempts(draft.minimumAttempts);
          setTimingMode(draft.timingMode);
          setDurationSeconds(draft.durationSeconds);
          setContactEvidenceRequired(draft.contactEvidenceRequired);
          setSpecialties(draft.specialties);
          setADay(draft.aDay);
          setRefs(draft.refs);
          setReason(draft.reason);
          if (draft.source) setSource(draft.source);
        }}
      />
      <form className="space-y-6" onSubmit={saveDraft}>
        <section className="grid gap-4 rounded-lg border border-border bg-card p-5 lg:grid-cols-2">
          <Label>
            <span className="text-sm text-foreground">Configured rule book</span>
            <Input
              readOnly
              value={source?.rule_book_version ?? 'Loading source…'}
              className={inputClass}
            />
          </Label>
          <Label>
            <span className="text-sm text-foreground">Executable policy revision</span>
            <Input
              required
              value={policyRevision}
              onChange={(event) => setPolicyRevision(event.target.value)}
              className={inputClass}
              placeholder={`${year}.policy.1`}
            />
          </Label>
          <Label className="lg:col-span-2">
            <span className="text-sm text-foreground">Human-readable policy language</span>
            <Textarea
              required
              minLength={20}
              maxLength={100000}
              rows={8}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className={inputClass}
            />
          </Label>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl text-foreground">Bid stages and order</h2>
              <p className="text-sm text-muted-foreground">
                All {participants.length} eligible members must appear exactly once.
              </p>
            </div>
            <Button
              type="button"
              onClick={() =>
                setStages((current) => [
                  ...current,
                  {
                    key: crypto.randomUUID(),
                    id: '',
                    label: '',
                    kind: 'MIXED',
                    memberIds: [],
                    positionIds: [],
                  },
                ])
              }
              className="rounded bg-destructive px-3 py-2 text-sm text-primary-foreground"
            >
              Add stage
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {stages.length === 0 ? (
              <p className="rounded border border-warning/40 p-3 text-sm text-warning">
                No stage is configured.
              </p>
            ) : null}
            {stages.map((stage, index) => (
              <article key={stage.key} className="rounded border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <strong className="mr-auto text-foreground">Stage {index + 1}</strong>
                  <Button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveStage(index, -1)}
                    className="rounded border border-border px-2 py-1 text-xs text-foreground disabled:opacity-30"
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    disabled={index === stages.length - 1}
                    onClick={() => moveStage(index, 1)}
                    className="rounded border border-border px-2 py-1 text-xs text-foreground disabled:opacity-30"
                  >
                    Down
                  </Button>
                  <Button
                    type="button"
                    onClick={() =>
                      setStages((current) => current.filter((item) => item.key !== stage.key))
                    }
                    className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive"
                  >
                    Remove
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <Input
                    aria-label="Stable stage ID"
                    value={stage.id}
                    onChange={(event) => updateStage(stage.key, { id: event.target.value })}
                    className={inputClass}
                    placeholder="Stable stage ID"
                  />
                  <Input
                    aria-label="Stage label"
                    value={stage.label}
                    onChange={(event) => updateStage(stage.key, { label: event.target.value })}
                    className={inputClass}
                    placeholder="Stage label"
                  />
                  <NativeSelect
                    aria-label="Stage kind"
                    value={stage.kind}
                    onChange={(event) =>
                      updateStage(stage.key, { kind: event.target.value as StageKind })
                    }
                    className={inputClass}
                  >
                    {stageKinds.map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <Label>
                    <span className="text-xs text-foreground">Real member population</span>
                    <NativeSelect
                      multiple
                      size={Math.min(10, Math.max(4, participants.length))}
                      value={stage.memberIds.map(String)}
                      onChange={(event) =>
                        updateStage(stage.key, { memberIds: selected(event.target).map(Number) })
                      }
                      className={inputClass}
                    >
                      {participants.map((member) => (
                        <option key={member.member_id} value={member.member_id}>
                          {member.rank} · {member.last_name}, {member.first_name} · {member.pool} ·
                          RSC {member.rsc_seniority}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Label>
                    <span className="text-xs text-foreground">Real opportunity scope</span>
                    <NativeSelect
                      multiple
                      size={Math.min(10, Math.max(4, source?.positions.length ?? 0))}
                      value={stage.positionIds}
                      onChange={(event) =>
                        updateStage(stage.key, { positionIds: selected(event.target) })
                      }
                      className={inputClass}
                    >
                      {source?.positions.map((position) => (
                        <option key={position.id} value={position.id}>
                          {position.id} · {position.shift} · Sta {position.station} ·{' '}
                          {position.unit} · {position.rank_required}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-xl text-foreground">Live action authority</h2>
          <p className="text-sm text-muted-foreground">
            Hub Admin access does not grant operational authority.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {actions.map((action) => (
              <Label key={action}>
                <span className="font-mono text-xs text-foreground">{action}</span>
                <NativeSelect
                  multiple
                  size={4}
                  value={permissions[action].map(String)}
                  onChange={(event) =>
                    setPermissions((current) => ({
                      ...current,
                      [action]: selected(event.target).map(Number),
                    }))
                  }
                  className={inputClass}
                >
                  {allMembers.map((member) => (
                    <option key={member.member_id} value={member.member_id}>
                      {member.rank} · {member.last_name}, {member.first_name}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-xl text-foreground">
            What happens when a member does not select?
          </h2>
          <p className="text-sm text-muted-foreground">
            Every row blocks readiness until Command Staff marks it configured.
          </p>
          <div className="mt-4 space-y-3">
            {dispositionNames.map((name) => {
              const rule = dispositions[name];
              return (
                <fieldset key={name} className="rounded border border-border p-3">
                  <legend className="px-2 font-mono text-sm text-foreground">{name}</legend>
                  <p className="my-3 text-sm">
                    {!rule.configured
                      ? 'Needs a reviewed decision.'
                      : `${rule.advances ? 'Move to the next bidder.' : 'Keep the current turn.'} ${rule.returns ? `Return during ${stages.find((s) => s.id === rule.returnStageId)?.label || rule.returnStageId || 'a stage that must be selected'}.` : 'No scheduled return.'} ${rule.retainsLaterSelectionRights ? 'Later selection rights are retained.' : 'Later selection rights are not retained.'} ${rule.terminal ? 'Participation ends.' : ''} ${rule.requiresReason ? 'A reason is required.' : ''} ${rule.requiresEvidence ? 'Supporting evidence is required.' : ''}`}
                  </p>
                  <details>
                    <summary>Edit the reviewed outcome and evidence requirements</summary>
                    <div className="flex flex-wrap gap-4 text-sm text-foreground">
                      <Label>
                        <Input
                          type="checkbox"
                          checked={rule.configured}
                          onChange={(event) =>
                            setDispositions((current) => ({
                              ...current,
                              [name]: { ...rule, configured: event.target.checked },
                            }))
                          }
                        />{' '}
                        Configured
                      </Label>
                      {(
                        [
                          'advances',
                          'returns',
                          'retainsLaterSelectionRights',
                          'terminal',
                          'requiresReason',
                          'requiresEvidence',
                        ] as const
                      ).map((field) => (
                        <Label key={field}>
                          <Input
                            type="checkbox"
                            checked={rule[field]}
                            onChange={(event) =>
                              setDispositions((current) => ({
                                ...current,
                                [name]: { ...rule, [field]: event.target.checked },
                              }))
                            }
                          />{' '}
                          {
                            {
                              advances: 'Advance to the next bidder',
                              returns: 'Return in another stage',
                              retainsLaterSelectionRights: 'Keep later selection rights',
                              terminal: 'End this member’s participation',
                              requiresReason: 'Reason required',
                              requiresEvidence: 'Evidence required',
                            }[field]
                          }
                        </Label>
                      ))}
                    </div>
                    {rule.returns ? (
                      <NativeSelect
                        aria-label={`${name} return stage`}
                        value={rule.returnStageId}
                        onChange={(event) =>
                          setDispositions((current) => ({
                            ...current,
                            [name]: { ...rule, returnStageId: event.target.value },
                          }))
                        }
                        className={inputClass}
                      >
                        <option value="">Select return stage</option>
                        {stages.map((stage) => (
                          <option key={stage.key} value={stage.id}>
                            {stage.label || stage.id}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : null}
                    <Input
                      aria-label={`${name} contact policy reference`}
                      value={rule.contactPolicyReference}
                      onChange={(event) =>
                        setDispositions((current) => ({
                          ...current,
                          [name]: { ...rule, contactPolicyReference: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder="Contact/evidence reference, if applicable"
                    />
                  </details>
                </fieldset>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-card p-5 md:grid-cols-4">
          <h2 className="font-heading text-xl text-foreground md:col-span-4">Contact policy</h2>
          <Label>
            <span className="text-xs text-foreground">Minimum attempts</span>
            <Input
              type="number"
              min="1"
              max="10"
              value={minimumAttempts}
              onChange={(event) => setMinimumAttempts(event.target.value)}
              className={inputClass}
            />
          </Label>
          <Label>
            <span className="text-xs text-foreground">Timing mode</span>
            <NativeSelect
              value={timingMode}
              onChange={(event) => setTimingMode(event.target.value as TimingMode)}
              className={inputClass}
            >
              <option value="HARD_MINIMUM">Required minimum time</option>
              <option value="TARGET">Target time</option>
              <option value="OPERATOR_DISCRETION">Operator discretion</option>
            </NativeSelect>
          </Label>
          <Label>
            <span className="text-xs text-foreground">Duration seconds</span>
            <Input
              type="number"
              min="0"
              disabled={timingMode === 'OPERATOR_DISCRETION'}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(event.target.value)}
              className={inputClass}
            />
          </Label>
          <Label className="self-end pb-2 text-sm text-foreground">
            <Input
              type="checkbox"
              checked={contactEvidenceRequired}
              onChange={(event) => setContactEvidenceRequired(event.target.checked)}
            />{' '}
            Evidence required
          </Label>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl text-foreground">Specialty policy</h2>
              <p className="text-sm text-muted-foreground">
                Frozen evaluation date: {source?.credential_evaluation_on ?? 'unavailable'}
              </p>
            </div>
            <Button
              type="button"
              onClick={() =>
                setSpecialties((current) => [
                  ...current,
                  {
                    key: crypto.randomUUID(),
                    id: '',
                    label: '',
                    mode: 'INTERRUPTING',
                    positionIds: [],
                    credentials: '',
                    qualifications: '',
                    points: '',
                    tieBreak: 'POINTS, RSC_SENIORITY',
                  },
                ])
              }
              className="rounded bg-destructive px-3 py-2 text-sm text-primary-foreground"
            >
              Add specialty
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {specialties.map((specialty) => (
              <article
                key={specialty.key}
                className="grid gap-3 rounded border border-border p-3 md:grid-cols-2"
              >
                <Input
                  aria-label="Specialty ID"
                  value={specialty.id}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key ? { ...item, id: event.target.value } : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="Specialty ID"
                />
                <Input
                  aria-label="Specialty name"
                  value={specialty.label}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="Specialty name"
                />
                <NativeSelect
                  aria-label="Specialty mode"
                  value={specialty.mode}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key
                          ? { ...item, mode: event.target.value as Specialty['mode'] }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                >
                  <option value="INTERRUPTING">Interrupt the main bid order</option>
                  <option value="PRIORITY_ONLY">Priority within the current stage</option>
                </NativeSelect>
                <NativeSelect
                  aria-label="Specialty positions"
                  multiple
                  size={4}
                  value={specialty.positionIds}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key
                          ? { ...item, positionIds: selected(event.target) }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                >
                  {source?.positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.id} · {position.position_name}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label="Required credentials"
                  value={specialty.credentials}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key
                          ? { ...item, credentials: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="Required credentials, comma separated"
                />
                <Input
                  aria-label="Required specialty qualifications"
                  value={specialty.qualifications}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key
                          ? { ...item, qualifications: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="Required specialty qualifications"
                />
                {!specialty.scoring && (
                  <Input
                    aria-label="Specialty points"
                    value={specialty.points}
                    onChange={(event) =>
                      setSpecialties((current) =>
                        current.map((item) =>
                          item.key === specialty.key
                            ? { ...item, points: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className={inputClass}
                    placeholder="Credential:8, Other:3"
                  />
                )}
                {!specialty.scoring ? (
                  <Button
                    type="button"
                    className="min-h-11 rounded border border-border px-3 text-sm"
                    onClick={() =>
                      setSpecialties((current) =>
                        current.map((item) =>
                          item.key !== specialty.key
                            ? item
                            : {
                                ...item,
                                rankingChannel: 'total',
                                scoring: {
                                  v: 1,
                                  total: [
                                    {
                                      id: crypto.randomUUID(),
                                      cap: null,
                                      items: csv(item.points).map((point) => {
                                        const [credential = '', raw = ''] = point
                                          .split(':')
                                          .map((s) => s.trim());
                                        return {
                                          credential,
                                          points: Number(raw),
                                          alternatives: [],
                                          requiresAll: [],
                                        };
                                      }),
                                    },
                                  ],
                                  so: [],
                                  mo: [],
                                },
                              },
                        ),
                      )
                    }
                  >
                    Configure grouped specialty scoring
                  </Button>
                ) : (
                  <section className="min-w-0 space-y-3 rounded border border-border p-3 md:col-span-2">
                    <Label className="block text-sm">
                      Specialty ranking channel
                      <NativeSelect
                        className={inputClass}
                        value={specialty.rankingChannel}
                        onChange={(e) =>
                          setSpecialties((current) =>
                            current.map((item) =>
                              item.key === specialty.key
                                ? {
                                    ...item,
                                    rankingChannel: e.target.value as 'total' | 'so' | 'mo',
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="total">Total points</option>
                        <option value="so">Special Operations points</option>
                        <option value="mo">Marine Operations points</option>
                      </NativeSelect>
                    </Label>
                    <p className="text-sm text-foreground">
                      The POINTS priority uses this specialty's selected channel. Review the groups,
                      approved alternatives, prerequisites and caps before saving. Position
                      eligibility still applies.
                    </p>
                    <ConfiguredScoringEditor
                      value={specialty.scoring}
                      visibleChannels={[specialty.rankingChannel ?? 'total']}
                      onChange={(scoring) =>
                        setSpecialties((current) =>
                          current.map((item) =>
                            item.key === specialty.key ? { ...item, scoring } : item,
                          ),
                        )
                      }
                    />
                  </section>
                )}
                <Input
                  aria-label="Specialty tie break"
                  value={specialty.tieBreak}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key
                          ? { ...item, tieBreak: event.target.value }
                          : item,
                      ),
                    )
                  }
                  className={inputClass}
                />
                <Button
                  type="button"
                  onClick={() =>
                    setSpecialties((current) =>
                      current.filter((item) => item.key !== specialty.key),
                    )
                  }
                  className="text-left text-sm text-destructive"
                >
                  Remove specialty
                </Button>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-xl text-foreground">A-Day deterministic limits</h2>
          <p className="text-sm text-muted-foreground">
            Values are intentionally blank until Command Staff supplies approved policy.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(aDay).map(([key, value]) => (
              <Label key={key}>
                <span className="text-xs text-foreground">{key}</span>
                <Input
                  type="number"
                  min="0"
                  value={value}
                  onChange={(event) =>
                    setADay((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className={inputClass}
                />
              </Label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-xl text-foreground">
            Policy references and revision reason
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Object.entries(refs).map(([key, value]) => (
              <Label key={key}>
                <span className="text-xs capitalize text-foreground">{key} policy reference</span>
                <Input
                  value={value}
                  onChange={(event) =>
                    setRefs((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className={inputClass}
                />
              </Label>
            ))}
          </div>
          <Textarea
            aria-label="Revision reason"
            required
            minLength={4}
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={inputClass}
            placeholder="Revision reason"
          />
          {message ? (
            <output
              className={`mt-3 block text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-success'}`}
            >
              {message.text}
            </output>
          ) : null}
          <Button
            type="submit"
            disabled={busy || !ready}
            className="mt-4 rounded bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save new draft revision'}
          </Button>
        </section>
      </form>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-xl text-foreground">Preview and revision history</h2>
        <div className="mt-3 space-y-3">
          {documents.length === 0 ? (
            <p className="text-sm text-foreground">No policy document is recorded for this year.</p>
          ) : (
            documents.map((document) => (
              <details key={document.id} className="rounded border border-border p-3">
                <summary className="cursor-pointer font-mono text-sm text-foreground">
                  Revision {document.revision} · {document.status}
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                  {document.policy_text}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => loadRevision(document)}
                    className="rounded border border-border px-3 py-1 text-sm text-foreground"
                  >
                    Load as new draft
                  </Button>
                  {document.status === 'DRAFT' ? (
                    source?.managed_annual_plan ? (
                      <Link
                        href={`/admin/annual-plan?year=${year}&stage=7` as Route}
                        className="inline-flex min-h-11 items-center text-info underline"
                      >
                        Practice and approve this annual plan
                      </Link>
                    ) : (
                      <AnnualPolicyPublishGate
                        busy={busy || !source}
                        onConfirm={(publishReason) => publish(document, publishReason)}
                      />
                    )
                  ) : null}
                  <span className="text-xs text-muted-foreground">Document {document.id}</span>
                  {document.supersedes_document_id ? (
                    <span className="text-xs text-muted-foreground">
                      Supersedes {document.supersedes_document_id}
                    </span>
                  ) : null}
                </div>
              </details>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
