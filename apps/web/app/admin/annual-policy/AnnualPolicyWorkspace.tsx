'use client';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { FrozenLiveBidPolicySchema } from '@mbfd/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
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
  'mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white';

export function AnnualPolicyWorkspace({ year, documents, loadError }: Props) {
  const router = useRouter();
  const csrfFetch = useMemo(() => createCsrfAwareFetch(fetch, () => window.location.origin), []);
  const [source, setSource] = useState<EditorSource | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/annual-policy-documents/${year}/editor-data`, { credentials: 'include' })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(workerError(body, `Source service returned ${response.status}.`));
        return body as EditorSource;
      })
      .then((body) => {
        if (active) setSource(body);
      })
      .catch((error: unknown) => {
        if (active)
          setSourceError(
            error instanceof Error ? error.message : 'Policy source could not be loaded.',
          );
      });
    return () => {
      active = false;
    };
  }, [year]);

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
          points: csv(specialty.points).map((item) => {
            const [credentialName = '', rawValue = ''] = item.split(':').map((part) => part.trim());
            return { credentialName, value: Number(rawValue) };
          }),
          tieBreakChain: csv(specialty.tieBreak),
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
    try {
      const response = await csrfFetch(`/api/admin/annual-policy-documents/${year}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_book_version: source.rule_book_version,
          policy_text: language.trim(),
          execution_policy: executionPolicy(),
          reason: reason.trim(),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(workerError(body, `Draft creation failed (${response.status}).`));
      setMessage({ kind: 'success', text: 'Draft saved and bound for mock verification.' });
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
    setBusy(true);
    setMessage(null);
    try {
      const response = await csrfFetch(
        `/api/admin/annual-policy-documents/${year}/${document.id}/publish`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: publishReason }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(workerError(body, `Publication failed (${response.status}).`));
      setMessage({ kind: 'success', text: `Revision ${document.revision} published.` });
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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
            Annual policy authority
          </p>
          <h1 className="mt-1 font-heading text-3xl text-white">Executable policy — {year}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Select real frozen members and positions. Unapproved rules remain visibly blocking.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-bold ${ready ? 'border-emerald-600 text-emerald-200' : 'border-amber-600 text-amber-200'}`}
        >
          {ready ? 'READY TO SAVE DRAFT' : 'NOT CONFIGURED — BLOCKING'}
        </span>
      </header>
      {loadError || sourceError ? (
        <p className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
          {loadError ?? sourceError}
        </p>
      ) : null}

      <form className="space-y-6" onSubmit={saveDraft}>
        <section className="grid gap-4 rounded-lg border border-slate-700 bg-slate-800/60 p-5 lg:grid-cols-2">
          <label>
            <span className="text-sm text-slate-200">Configured rule book</span>
            <input
              readOnly
              value={source?.rule_book_version ?? 'Loading source…'}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-sm text-slate-200">Executable policy revision</span>
            <input
              required
              value={policyRevision}
              onChange={(event) => setPolicyRevision(event.target.value)}
              className={inputClass}
              placeholder={`${year}.policy.1`}
            />
          </label>
          <label className="lg:col-span-2">
            <span className="text-sm text-slate-200">Human-readable policy language</span>
            <textarea
              required
              minLength={20}
              maxLength={100000}
              rows={8}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className={inputClass}
            />
          </label>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl text-white">Bid stages and order</h2>
              <p className="text-sm text-slate-400">
                All {participants.length} eligible members must appear exactly once.
              </p>
            </div>
            <button
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
              className="rounded bg-red-700 px-3 py-2 text-sm text-white"
            >
              Add stage
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {stages.length === 0 ? (
              <p className="rounded border border-amber-700 p-3 text-sm text-amber-200">
                No stage is configured.
              </p>
            ) : null}
            {stages.map((stage, index) => (
              <article
                key={stage.key}
                className="rounded border border-slate-600 bg-slate-900/50 p-4"
              >
                <div className="flex items-center gap-2">
                  <strong className="mr-auto text-white">Stage {index + 1}</strong>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveStage(index, -1)}
                    className="rounded border border-slate-600 px-2 py-1 text-xs text-white disabled:opacity-30"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={index === stages.length - 1}
                    onClick={() => moveStage(index, 1)}
                    className="rounded border border-slate-600 px-2 py-1 text-xs text-white disabled:opacity-30"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setStages((current) => current.filter((item) => item.key !== stage.key))
                    }
                    className="rounded border border-red-700 px-2 py-1 text-xs text-red-200"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <input
                    aria-label="Stable stage ID"
                    value={stage.id}
                    onChange={(event) => updateStage(stage.key, { id: event.target.value })}
                    className={inputClass}
                    placeholder="Stable stage ID"
                  />
                  <input
                    aria-label="Stage label"
                    value={stage.label}
                    onChange={(event) => updateStage(stage.key, { label: event.target.value })}
                    className={inputClass}
                    placeholder="Stage label"
                  />
                  <select
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
                  </select>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <label>
                    <span className="text-xs text-slate-300">Real member population</span>
                    <select
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
                    </select>
                  </label>
                  <label>
                    <span className="text-xs text-slate-300">Real opportunity scope</span>
                    <select
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
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
          <h2 className="font-heading text-xl text-white">Live action authority</h2>
          <p className="text-sm text-slate-400">
            Hub Admin access does not grant operational authority.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {actions.map((action) => (
              <label key={action}>
                <span className="font-mono text-xs text-slate-300">{action}</span>
                <select
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
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
          <h2 className="font-heading text-xl text-white">Disposition rules</h2>
          <p className="text-sm text-slate-400">
            Every row blocks readiness until Command Staff marks it configured.
          </p>
          <div className="mt-4 space-y-3">
            {dispositionNames.map((name) => {
              const rule = dispositions[name];
              return (
                <fieldset key={name} className="rounded border border-slate-600 p-3">
                  <legend className="px-2 font-mono text-sm text-white">{name}</legend>
                  <div className="flex flex-wrap gap-4 text-sm text-slate-200">
                    <label>
                      <input
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
                    </label>
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
                      <label key={field}>
                        <input
                          type="checkbox"
                          checked={rule[field]}
                          onChange={(event) =>
                            setDispositions((current) => ({
                              ...current,
                              [name]: { ...rule, [field]: event.target.checked },
                            }))
                          }
                        />{' '}
                        {field}
                      </label>
                    ))}
                  </div>
                  {rule.returns ? (
                    <select
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
                    </select>
                  ) : null}
                  <input
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
                </fieldset>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-slate-700 bg-slate-800/60 p-5 md:grid-cols-4">
          <h2 className="font-heading text-xl text-white md:col-span-4">Contact policy</h2>
          <label>
            <span className="text-xs text-slate-300">Minimum attempts</span>
            <input
              type="number"
              min="1"
              max="10"
              value={minimumAttempts}
              onChange={(event) => setMinimumAttempts(event.target.value)}
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-xs text-slate-300">Timing mode</span>
            <select
              value={timingMode}
              onChange={(event) => setTimingMode(event.target.value as TimingMode)}
              className={inputClass}
            >
              <option>HARD_MINIMUM</option>
              <option>TARGET</option>
              <option>OPERATOR_DISCRETION</option>
            </select>
          </label>
          <label>
            <span className="text-xs text-slate-300">Duration seconds</span>
            <input
              type="number"
              min="0"
              disabled={timingMode === 'OPERATOR_DISCRETION'}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="self-end pb-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={contactEvidenceRequired}
              onChange={(event) => setContactEvidenceRequired(event.target.checked)}
            />{' '}
            Evidence required
          </label>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl text-white">Specialty policy</h2>
              <p className="text-sm text-slate-400">
                Frozen evaluation date: {source?.credential_evaluation_on ?? 'unavailable'}
              </p>
            </div>
            <button
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
              className="rounded bg-red-700 px-3 py-2 text-sm text-white"
            >
              Add specialty
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {specialties.map((specialty) => (
              <article
                key={specialty.key}
                className="grid gap-3 rounded border border-slate-600 p-3 md:grid-cols-2"
              >
                <input
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
                <input
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
                <select
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
                  <option>INTERRUPTING</option>
                  <option>PRIORITY_ONLY</option>
                </select>
                <select
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
                </select>
                <input
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
                <input
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
                <input
                  aria-label="Specialty points"
                  value={specialty.points}
                  onChange={(event) =>
                    setSpecialties((current) =>
                      current.map((item) =>
                        item.key === specialty.key ? { ...item, points: event.target.value } : item,
                      ),
                    )
                  }
                  className={inputClass}
                  placeholder="Credential:8, Other:3"
                />
                <input
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
                <button
                  type="button"
                  onClick={() =>
                    setSpecialties((current) =>
                      current.filter((item) => item.key !== specialty.key),
                    )
                  }
                  className="text-left text-sm text-red-300"
                >
                  Remove specialty
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
          <h2 className="font-heading text-xl text-white">A-Day deterministic limits</h2>
          <p className="text-sm text-slate-400">
            Values are intentionally blank until Command Staff supplies approved policy.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(aDay).map(([key, value]) => (
              <label key={key}>
                <span className="text-xs text-slate-300">{key}</span>
                <input
                  type="number"
                  min="0"
                  value={value}
                  onChange={(event) =>
                    setADay((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className={inputClass}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
          <h2 className="font-heading text-xl text-white">Policy references and revision reason</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Object.entries(refs).map(([key, value]) => (
              <label key={key}>
                <span className="text-xs capitalize text-slate-300">{key} policy reference</span>
                <input
                  value={value}
                  onChange={(event) =>
                    setRefs((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <textarea
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
              className={`mt-3 block text-sm ${message.kind === 'error' ? 'text-red-300' : 'text-emerald-300'}`}
            >
              {message.text}
            </output>
          ) : null}
          <button
            type="submit"
            disabled={busy || !ready}
            className="mt-4 rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save new draft revision'}
          </button>
        </section>
      </form>

      <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-5">
        <h2 className="font-heading text-xl text-white">Preview and revision history</h2>
        <div className="mt-3 space-y-3">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-300">No policy document is recorded for this year.</p>
          ) : (
            documents.map((document) => (
              <details key={document.id} className="rounded border border-slate-700 p-3">
                <summary className="cursor-pointer font-mono text-sm text-white">
                  Revision {document.revision} · {document.status}
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
                  {document.policy_text}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => loadRevision(document)}
                    className="rounded border border-slate-500 px-3 py-1 text-sm text-slate-100"
                  >
                    Load as new draft
                  </button>
                  {document.status === 'DRAFT' ? (
                    <AnnualPolicyPublishGate
                      busy={busy}
                      onConfirm={(publishReason) => publish(document, publishReason)}
                    />
                  ) : null}
                  <span className="text-xs text-slate-400">Document {document.id}</span>
                  {document.supersedes_document_id ? (
                    <span className="text-xs text-slate-400">
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
