'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

type ReviewDecision =
  | 'accept_observation'
  | 'keep_current'
  | 'defer_new_position'
  | 'reject_source_row'
  | 'retain_incomplete_source_row';

type SourceObservationTimeBasis = 'date_only' | 'source_metadata' | 'administrator_confirmed';

type TeleStaffSourceKind = 'official' | 'synthetic_test';

interface ImportSummary {
  id: string;
  sourceFormat: string | null;
  parserVersion: string | null;
  sourceKind: TeleStaffSourceKind | 'legacy_unclassified';
  status: 'staged' | 'reviewed' | 'approved' | 'committed' | 'rejected';
  sourceSnapshotAsOf: string | null;
  sourceObservedAt: number | null;
  sourceObservationTimeBasis: SourceObservationTimeBasis;
  reconciliationRevision: number;
  normalizedDataRowCount: number | null;
  uniqueEmployeeCount: number | null;
  reconciliation: {
    sourceRows: number;
    pendingSourceRows: number;
    hardBlockerSourceRows: number;
    incompleteTopologySourceRows: number;
    missingObservationFindings: number;
    pendingMissingObservationFindings: number;
  };
}

interface Preview {
  sourceKind: TeleStaffSourceKind;
  sourceSnapshotAsOf: string;
  sourceObservedAt: number | null;
  sourceObservationTimeBasis: SourceObservationTimeBasis;
  sourceFormat: string;
  parserVersion: string;
  inputRowCount: number;
  normalizedDataRowCount: number;
  uniqueEmployeeCount: number;
  reportRowCount: number;
  structuralRowCount: number;
  incompleteTopologyCount: number;
  missingSourceARDayCount: number;
}

interface ReconciliationRow {
  id: string;
  sourceRowNumber: number;
  hasSourceARDay: boolean;
  disposition: string;
  reconciliationClassification: string | null;
  reviewStatus: string;
  resolutionAction: string | null;
  sourceTopologyCompleteness: 'complete' | 'incomplete';
  hasResolvedMember: boolean;
  hasStaffingPositionSourceMapping: boolean;
  reviewState: string;
  allowedReviewActions: ReviewDecision[];
}

interface ImportDetail {
  import: ImportSummary;
  rows: ReconciliationRow[];
  missingObservationFindings: Array<{
    classification: string;
    reviewStatus: string;
    resolutionAction: string | null;
    hasAssignmentContext: boolean;
  }>;
  pagination: { totalRows: number };
}

interface ApiError {
  error?: unknown;
}

interface CertificationResult {
  requestedCertifications: number;
  createdCanonicalStaffingPositions: number;
  createdSourceMappings: number;
  existingIdempotentMatches: number;
  unresolvedObservations: number;
  skippedCollisions: number;
  failures: string[];
  idempotent: boolean;
}

interface SafeExceptionResolutionResult {
  deferredRepeatedTopology: number;
  retainedIncompleteTopology: number;
  rejectedUnknownPerson: number;
  rejectedAmbiguousMapping: number;
  idempotent: boolean;
}

const REVIEW_PAGE_SIZE = 100;

interface DeterministicReviewResult {
  acceptedObservations: number;
  idempotent: boolean;
}

interface BaselineAcceptanceResult {
  acceptanceId: string;
  importId: string;
  idempotent: boolean;
  supersededAcceptanceId: string | null;
  baseline: { status: string };
}

interface UnknownEmployeeIdentity {
  rowId: string;
  sourceRowNumber: number;
  sourceEmployeeId: string;
  sourceDisplayName: string;
}

interface UnknownEmployeeDraft {
  firstName: string;
  lastName: string;
  rank: '' | 'CIVILIAN' | 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  bidCategory: '' | 'OFC' | 'FF' | 'EXCLUDED';
  rscSeniority: string;
  rankSeniority: string;
  effectiveOn: string;
}

function errorCode(body: unknown, fallback: string): string {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const value = (body as ApiError).error;
    if (typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value)) return value;
  }
  return fallback;
}

export function teleStaffErrorCopy(error: string): string {
  switch (error) {
    case 'canonical_state_changed':
      return 'Canonical staffing changed after this import was reviewed. Retry after reloading the import. Exact prior TeleStaff matches are preserved automatically; a different member or seat remains blocked for review.';
    case 'step_up_required':
      return 'Fresh administrator authentication is required. After sign-in, you will return to this TeleStaff review.';
    case 'terminal_reconciliation_required':
      return 'Finish the pending review items before applying. The counts above must show zero pending rows and zero hard blockers.';
    case 'baseline_already_accepted':
      return 'A different 2026 baseline is already accepted. Review the selected committed import and use the confirmation step to replace it while preserving the prior receipt.';
    default:
      return `The requested operation was not completed: ${error.replaceAll('_', ' ')}.`;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function reviewActionLabel(action: ReviewDecision): string {
  switch (action) {
    case 'accept_observation':
      return 'Accept observation';
    case 'keep_current':
      return 'Keep current';
    case 'defer_new_position':
      return 'Defer topology';
    case 'retain_incomplete_source_row':
      return 'Retain incomplete row';
    case 'reject_source_row':
      return 'Reject source row';
  }
}

function reviewStateCopy(state: string): string {
  switch (state) {
    case 'CURRENT_RECORD_NEWER_THAN_SOURCE_OBSERVATION':
      return 'Newer protected staffing record';
    case 'NEW_TOPOLOGY_REVIEW_REQUIRED':
      return 'New topology review required';
    case 'AMBIGUOUS_MAPPING_REVIEW_REQUIRED':
      return 'Ambiguous mapping review required';
    case 'INCOMPLETE_TOPOLOGY_REVIEW_REQUIRED':
      return 'Incomplete topology review required';
    case 'UNKNOWN_EMPLOYEE_REVIEW_REQUIRED':
      return 'Unknown employee review required';
    case 'NO_ACTION_REQUIRED':
      return 'No action required';
    default:
      return state
        .toLowerCase()
        .split('_')
        .map((word) => word[0]?.toUpperCase() + word.slice(1))
        .join(' ');
  }
}

function importStatusClass(status: ImportSummary['status']): string {
  if (status === 'committed') return 'border-success/40 bg-success-surface text-success';
  if (status === 'reviewed') return 'border-info/40 bg-info-surface text-info';
  if (status === 'rejected') return 'border-border bg-card text-foreground';
  return 'border-warning/40 bg-warning-surface text-warning';
}

function sourceObservationTimeCopy(
  sourceObservedAt: number | null | undefined,
  basis: SourceObservationTimeBasis | undefined,
): string {
  if (sourceObservedAt === null || sourceObservedAt === undefined || basis === 'date_only') {
    return 'Report date only; exact time not provided.';
  }
  const timestamp = new Date(sourceObservedAt);
  if (!Number.isFinite(timestamp.getTime())) return 'Exact source time is unavailable.';
  const label =
    basis === 'source_metadata' ? 'Time supplied in report' : 'Time confirmed by administrator';
  return `${label}: ${timestamp.toISOString()}`;
}

function sourceKindLabel(sourceKind: ImportSummary['sourceKind'] | Preview['sourceKind']): string {
  switch (sourceKind) {
    case 'official':
      return 'Official source';
    case 'synthetic_test':
      return 'Test report — cannot change Department staffing';
    case 'legacy_unclassified':
      return 'Older report with unconfirmed source — cannot change Department staffing';
  }
}

function importFormData(
  file: File | null,
  sourceSnapshotAsOf: string,
  sourceObservedAt: string,
  sourceObservationTimeBasis: SourceObservationTimeBasis,
  sourceKind: TeleStaffSourceKind | '',
): FormData | null {
  if (file === null || sourceSnapshotAsOf === '' || sourceKind === '') return null;
  const data = new FormData();
  data.set('file', file);
  data.set('source_snapshot_as_of', sourceSnapshotAsOf);
  data.set('source_kind', sourceKind);
  data.set('source_observation_time_basis', sourceObservationTimeBasis);
  if (sourceObservationTimeBasis !== 'date_only') {
    data.set('source_observed_at', sourceObservedAt);
  }
  return data;
}

export function UnknownEmployeeOnboardingPanel(props: {
  importId: string;
  expectedRevision: number;
  employees: UnknownEmployeeIdentity[];
  busy: boolean;
  onComplete: () => void | Promise<void>;
  onError: (code: string) => void;
  onPendingChanges?: (pending: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, UnknownEmployeeDraft>>(() =>
    Object.fromEntries(
      props.employees.map((employee) => [
        employee.rowId,
        {
          firstName: '',
          lastName: '',
          rank: '',
          bidCategory: '',
          rscSeniority: '',
          rankSeniority: '',
          effectiveOn: '',
        },
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const pendingDetails =
    submitting ||
    Object.values(drafts).some((draft) => Object.values(draft).some((value) => value !== ''));
  useEffect(() => {
    props.onPendingChanges?.(pendingDetails);
    return () => props.onPendingChanges?.(false);
  }, [pendingDetails, props.onPendingChanges]);

  function update(rowId: string, values: Partial<UnknownEmployeeDraft>) {
    setDrafts((current) => {
      const existing = current[rowId];
      return existing === undefined ? current : { ...current, [rowId]: { ...existing, ...values } };
    });
  }

  async function submit() {
    const entries = props.employees.map((employee) => ({
      employee,
      draft: drafts[employee.rowId],
    }));
    if (
      entries.some(
        ({ draft }) =>
          draft === undefined ||
          draft.firstName.trim() === '' ||
          draft.lastName.trim() === '' ||
          draft.rank === '' ||
          draft.bidCategory === '' ||
          (draft.bidCategory !== 'EXCLUDED' && !/^\d+$/.test(draft.rscSeniority)) ||
          draft.effectiveOn === '',
      )
    ) {
      props.onError('complete_reviewed_employee_details_required');
      return;
    }
    setSubmitting(true);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      for (const { employee, draft } of entries) {
        if (draft === undefined || draft.rank === '' || draft.bidCategory === '') continue;
        const response = await csrfFetch('/api/admin/personnel/changes', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `telestaff-onboard:${props.importId}:${employee.rowId}`,
          },
          body: JSON.stringify({
            kind: 'NEW_HIRE',
            new_member: {
              employee_id: employee.sourceEmployeeId,
              first_name: draft.firstName.trim(),
              last_name: draft.lastName.trim(),
              rank: draft.rank === 'CIVILIAN' ? null : draft.rank,
              bid_category: draft.bidCategory,
              ...(draft.rscSeniority === '' ? {} : { rsc_seniority: Number(draft.rscSeniority) }),
              ...(draft.rankSeniority === ''
                ? {}
                : { rank_seniority: Number(draft.rankSeniority) }),
              ...(draft.bidCategory === 'EXCLUDED' ? {} : { hired_at: draft.effectiveOn }),
            },
            effective_on: draft.effectiveOn,
            reason: 'Reviewed TeleStaff unknown employee onboarding.',
          }),
        });
        const body = await parseResponse(response);
        if (
          !response.ok &&
          !(response.status === 409 && errorCode(body, '') === 'employee_id_exists')
        ) {
          props.onError(errorCode(body, 'personnel_onboarding_unavailable'));
          return;
        }
      }
      const reconcile = await csrfFetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(props.importId)}/reconcile`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_reconciliation_revision: props.expectedRevision,
          }),
        },
      );
      const reconcileBody = await parseResponse(reconcile);
      if (!reconcile.ok) {
        props.onError(errorCode(reconcileBody, 'reconciliation_unavailable'));
        return;
      }
      await props.onComplete();
    } catch {
      props.onError('personnel_onboarding_unavailable');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      data-testid="telestaff-unknown-onboarding"
      className="mt-4 rounded-lg border border-violet-700 bg-violet-950/30 p-4"
    >
      <h3 className="font-semibold text-foreground">Unknown employee onboarding</h3>
      <p className="mt-2 text-sm text-foreground">
        Names and employee IDs from this upload stay on this page until you review them; they are
        not saved in the import history. Confirm personnel details before adding anyone. Rank,
        category, and seniority are not inferred from TeleStaff.
      </p>
      <div className="mt-4 space-y-4">
        {props.employees.map((employee) => {
          const draft = drafts[employee.rowId];
          if (draft === undefined) return null;
          return (
            <fieldset key={employee.rowId} className="rounded border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">
                Source row {employee.sourceRowNumber}: {employee.sourceDisplayName} ·{' '}
                {employee.sourceEmployeeId}
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <OnboardingInput
                  name={`first_name-${employee.rowId}`}
                  label="Canonical first name"
                  value={draft.firstName}
                  onChange={(value) => update(employee.rowId, { firstName: value })}
                />
                <OnboardingInput
                  name={`last_name-${employee.rowId}`}
                  label="Canonical last name"
                  value={draft.lastName}
                  onChange={(value) => update(employee.rowId, { lastName: value })}
                />
                <Label className="block text-sm text-foreground">
                  Rank
                  <NativeSelect
                    name={`rank-${employee.rowId}`}
                    required
                    value={draft.rank}
                    onChange={(event) => {
                      const rank = event.target.value as UnknownEmployeeDraft['rank'];
                      update(employee.rowId, {
                        rank,
                        ...(rank === 'CIVILIAN'
                          ? {
                              bidCategory: 'EXCLUDED' as const,
                              rscSeniority: '',
                              rankSeniority: '',
                            }
                          : {}),
                      });
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                  >
                    <option value="">Select rank</option>
                    <option value="CIVILIAN">Civilian / no fire rank</option>
                    {['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'].map((rank) => (
                      <option key={rank} value={rank}>
                        {rank}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
                <Label className="block text-sm text-foreground">
                  Bid category
                  <NativeSelect
                    name={`bid_category-${employee.rowId}`}
                    required
                    value={draft.bidCategory}
                    onChange={(event) =>
                      update(employee.rowId, {
                        bidCategory: event.target.value as UnknownEmployeeDraft['bidCategory'],
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                  >
                    <option value="">Select category</option>
                    <option value="FF">FF</option>
                    <option value="OFC">OFC</option>
                    <option value="EXCLUDED">EXCLUDED</option>
                  </NativeSelect>
                </Label>
                <OnboardingInput
                  name={`rsc_seniority-${employee.rowId}`}
                  label={
                    draft.bidCategory === 'EXCLUDED'
                      ? 'RSC seniority (not required for excluded personnel)'
                      : 'RSC seniority'
                  }
                  type="number"
                  required={draft.bidCategory !== 'EXCLUDED'}
                  value={draft.rscSeniority}
                  onChange={(value) => update(employee.rowId, { rscSeniority: value })}
                />
                <OnboardingInput
                  name={`rank_seniority-${employee.rowId}`}
                  label="Rank seniority (optional)"
                  type="number"
                  required={false}
                  value={draft.rankSeniority}
                  onChange={(value) => update(employee.rowId, { rankSeniority: value })}
                />
                <OnboardingInput
                  name={`effective_on-${employee.rowId}`}
                  label={
                    draft.bidCategory === 'EXCLUDED'
                      ? 'Roster record date (not a hire date)'
                      : 'Hire effective date'
                  }
                  type="date"
                  value={draft.effectiveOn}
                  onChange={(value) => update(employee.rowId, { effectiveOn: value })}
                />
              </div>
            </fieldset>
          );
        })}
      </div>
      <Button
        data-testid="telestaff-onboard-unknown-submit"
        type="button"
        disabled={props.busy || submitting}
        onClick={() => void submit()}
        className="mt-4 min-h-11 rounded bg-violet-600 px-4 text-sm font-semibold text-foreground disabled:opacity-50"
      >
        {submitting
          ? 'Creating reviewed personnel…'
          : `Create or link ${props.employees.length} reviewed employee(s)`}
      </Button>
    </section>
  );
}

function OnboardingInput(props: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'date';
  required?: boolean;
}) {
  return (
    <Label className="block text-sm text-foreground">
      {props.label}
      <Input
        name={props.name}
        type={props.type ?? 'text'}
        min={props.type === 'number' ? 0 : undefined}
        required={props.required ?? true}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
      />
    </Label>
  );
}

/**
 * Retained views display only sanitized reconciliation metadata. Immediately
 * after staging, unknown identities may be displayed transiently for explicit
 * reviewed onboarding; they are never retained by the server.
 */
export function TeleStaffOperatorWorkspace() {
  const [baselineYear, setBaselineYear] = useState(new Date().getFullYear());
  const refreshProjections = usePersonnelProjectionRefresh();
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<TeleStaffSourceKind | ''>('');
  const [sourceSnapshotAsOf, setSourceSnapshotAsOf] = useState('');
  const [sourceObservedAt, setSourceObservedAt] = useState('');
  const [sourceObservationTimeBasis, setSourceObservationTimeBasis] =
    useState<SourceObservationTimeBasis>('date_only');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [unknownEmployees, setUnknownEmployees] = useState<UnknownEmployeeIdentity[]>([]);
  const [canonicalEffectiveOn, setCanonicalEffectiveOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [certification, setCertification] = useState<CertificationResult | null>(null);
  const [safeExceptionResolution, setSafeExceptionResolution] =
    useState<SafeExceptionResolutionResult | null>(null);
  const [deterministicReview, setDeterministicReview] = useState<DeterministicReviewResult | null>(
    null,
  );
  const [baselineAcceptance, setBaselineAcceptance] = useState<BaselineAcceptanceResult | null>(
    null,
  );
  const [baselineConfirmationRequired, setBaselineConfirmationRequired] = useState(false);
  const [onboardingDirty, setOnboardingDirty] = useState(false);
  const [recordedSource, setRecordedSource] = useState<{
    file: File | null;
    sourceKind: TeleStaffSourceKind | '';
    sourceSnapshotAsOf: string;
    sourceObservedAt: string;
    sourceObservationTimeBasis: SourceObservationTimeBasis;
  }>({
    file: null,
    sourceKind: '',
    sourceSnapshotAsOf: '',
    sourceObservedAt: '',
    sourceObservationTimeBasis: 'date_only',
  });
  const [recordedApply, setRecordedApply] = useState<{ importId: string; date: string } | null>(
    null,
  );
  const sourceDirty =
    file !== recordedSource.file ||
    sourceKind !== recordedSource.sourceKind ||
    sourceSnapshotAsOf !== recordedSource.sourceSnapshotAsOf ||
    sourceObservedAt !== recordedSource.sourceObservedAt ||
    sourceObservationTimeBasis !== recordedSource.sourceObservationTimeBasis;
  const applyDateDirty =
    canonicalEffectiveOn !== '' &&
    (recordedApply?.importId !== detail?.import.id || recordedApply?.date !== canonicalEffectiveOn);
  useUnsavedChanges(
    busy || sourceDirty || applyDateDirty || onboardingDirty || baselineConfirmationRequired,
    'TeleStaff import details or pending requests',
  );

  async function loadImport(importId: string, offset = 0): Promise<ImportDetail | null> {
    const pageQuery = offset === 0 ? '' : `?limit=${REVIEW_PAGE_SIZE}&offset=${offset}`;
    const response = await fetch(
      `/api/admin/telestaff/imports/${encodeURIComponent(importId)}${pageQuery}`,
      { credentials: 'include' },
    );
    const body = await parseResponse(response);
    if (!response.ok || body === null || typeof body !== 'object') {
      setError(errorCode(body, 'import_detail_unavailable'));
      return null;
    }
    const loaded = body as ImportDetail;
    setDetail(loaded);
    setReviewOffset(offset);
    return loaded;
  }

  const loadImports = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/admin/telestaff/imports?limit=25', {
      credentials: 'include',
    });
    const body = await parseResponse(response);
    if (!response.ok || body === null || typeof body !== 'object' || !('imports' in body)) return;
    const candidate = (body as { imports?: unknown }).imports;
    if (Array.isArray(candidate)) setImports(candidate as ImportSummary[]);
  }, []);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  function resetPreviewForNewInput() {
    setPreview(null);
    setNotice(null);
    setError(null);
  }

  async function previewSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = importFormData(
      file,
      sourceSnapshotAsOf,
      sourceObservedAt,
      sourceObservationTimeBasis,
      sourceKind,
    );
    if (data === null) {
      setError('file_and_source_snapshot_required');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/telestaff/imports/preview', {
        method: 'POST',
        credentials: 'include',
        body: data,
      });
      const body = await parseResponse(response);
      if (!response.ok || body === null || typeof body !== 'object' || !('preview' in body)) {
        setError(errorCode(body, 'preview_unavailable'));
        return;
      }
      setPreview((body as { preview: Preview }).preview);
      setNotice(
        'Sanitized preview is ready. Staging will reparse the selected source in request memory.',
      );
    } catch {
      setError('preview_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function stageSource() {
    const data = importFormData(
      file,
      sourceSnapshotAsOf,
      sourceObservedAt,
      sourceObservationTimeBasis,
      sourceKind,
    );
    if (data === null || preview === null) {
      setError('preview_required_before_stage');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/telestaff/imports', {
        method: 'POST',
        credentials: 'include',
        body: data,
      });
      const body = await parseResponse(response);
      if (!response.ok && response.status !== 202) {
        setError(errorCode(body, 'stage_unavailable'));
        return;
      }
      const importId =
        body !== null && typeof body === 'object'
          ? 'import' in body &&
            (body as { import?: { id?: unknown } }).import !== undefined &&
            typeof (body as { import: { id?: unknown } }).import.id === 'string'
            ? (body as { import: { id: string } }).import.id
            : 'importId' in body && typeof (body as { importId?: unknown }).importId === 'string'
              ? (body as { importId: string }).importId
              : null
          : null;
      if (importId === null) {
        setError('stage_unavailable');
        return;
      }
      setRecordedSource({
        file,
        sourceKind,
        sourceSnapshotAsOf,
        sourceObservedAt,
        sourceObservationTimeBasis,
      });
      const transientUnknowns =
        body !== null &&
        typeof body === 'object' &&
        'unknownEmployees' in body &&
        Array.isArray((body as { unknownEmployees?: unknown }).unknownEmployees)
          ? (body as { unknownEmployees: UnknownEmployeeIdentity[] }).unknownEmployees
          : [];
      setUnknownEmployees(transientUnknowns);
      await Promise.all([loadImport(importId), loadImports()]);
      setPreview(null);
      setNotice(
        response.status === 202
          ? 'The import was saved for review; it cannot change Department staffing.'
          : 'The import is ready for review.',
      );
    } catch {
      setError('stage_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function reviewRow(row: ReconciliationRow, decision: ReviewDecision) {
    if (detail === null || !row.allowedReviewActions.includes(decision)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/rows/${encodeURIComponent(row.id)}/review`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_reconciliation_revision: detail.import.reconciliationRevision,
            decision,
          }),
        },
      );
      const body = await parseResponse(response);
      if (!response.ok) {
        setError(errorCode(body, 'review_unavailable'));
        return;
      }
      await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
      setNotice('Review decision saved. Department staffing remains unchanged.');
    } catch {
      setError('review_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function applyCanonical() {
    if (detail === null || canonicalEffectiveOn === '') {
      setError('canonical_effective_date_required');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/apply`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_reconciliation_revision: detail.import.reconciliationRevision,
            canonical_effective_on: canonicalEffectiveOn,
          }),
        },
      );
      const body = await parseResponse(response);
      if (!response.ok) {
        setError(errorCode(body, 'canonical_apply_unavailable'));
        return;
      }
      setRecordedApply({ importId: detail.import.id, date: canonicalEffectiveOn });
      await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
      setNotice('Department staffing was updated for reviewed assignments with confirmed matches.');
      await refreshProjections();
    } catch {
      setError('canonical_apply_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function certifyDeterministicStaffing() {
    if (detail === null) return;
    const confirmed = window.confirm(
      'Create approved Department staffing positions for the confirmed matches in this import?\n\n' +
        'This saves the report-to-position matches and approves those rows. Unclear positions remain unresolved. Personnel assignments are applied in a separate step.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setCertification(null);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const response = await csrfFetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/certify-deterministic-staffing`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_reconciliation_revision: detail.import.reconciliationRevision,
            reason: 'Operator-approved deterministic TeleStaff staffing certification for staging.',
          }),
        },
      );
      const body = await parseResponse(response);
      const result =
        body !== null &&
        typeof body === 'object' &&
        'certification' in body &&
        (body as { certification?: unknown }).certification !== null &&
        typeof (body as { certification?: unknown }).certification === 'object'
          ? ((body as { certification: CertificationResult }).certification as CertificationResult)
          : null;
      if (!response.ok || result === null) {
        setError(errorCode(body, 'staffing_certification_unavailable'));
        return;
      }
      setCertification(result);
      await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
      setNotice(
        result.idempotent
          ? 'The previous position review was confirmed; no duplicate staffing positions were created.'
          : 'Staffing positions were confirmed. The results are shown below.',
      );
    } catch {
      setError('staffing_certification_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function resolveSafeExceptions() {
    if (detail === null) return;
    if (
      !window.confirm(
        'Save review decisions for these exceptions? Repeated positions will be deferred without assigning a seat. Incomplete records will be retained without creating positions. Rows with unknown people or unclear position matches will be rejected. Personnel assignments will not change.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setSafeExceptionResolution(null);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const response = await csrfFetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/resolve-safe-exceptions`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_reconciliation_revision: detail.import.reconciliationRevision,
            reason: 'Operator-approved terminal resolution of non-materializable staging evidence.',
          }),
        },
      );
      const body = await parseResponse(response);
      const counts =
        body !== null &&
        typeof body === 'object' &&
        'counts' in body &&
        (body as { counts?: unknown }).counts !== null &&
        typeof (body as { counts?: unknown }).counts === 'object'
          ? (
              body as {
                counts: Omit<SafeExceptionResolutionResult, 'idempotent'>;
                idempotent?: unknown;
              }
            ).counts
          : null;
      if (!response.ok || counts === null) {
        setError(errorCode(body, 'safe_exception_resolution_unavailable'));
        return;
      }
      const result = {
        ...counts,
        idempotent: (body as { idempotent?: unknown }).idempotent === true,
      };
      setSafeExceptionResolution(result);
      await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
      setNotice(
        result.idempotent
          ? 'No eligible exceptions remained; Department staffing was not changed.'
          : 'Exception review decisions were saved; Department staffing was not changed.',
      );
    } catch {
      setError('safe_exception_resolution_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function reviewDeterministicObservations() {
    if (detail === null) return;
    if (
      !window.confirm(
        'Accept every TeleStaff row with a confirmed match? Rows affecting newer protected assignments, unclear positions, incomplete records, or unknown personnel will not be accepted.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setDeterministicReview(null);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const response = await csrfFetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/review-deterministic-observations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_reconciliation_revision: detail.import.reconciliationRevision,
            reason:
              'Operator-approved deterministic TeleStaff observations for canonical apply review.',
          }),
        },
      );
      const body = await parseResponse(response);
      const result =
        body !== null &&
        typeof body === 'object' &&
        'acceptedObservations' in body &&
        typeof (body as { acceptedObservations?: unknown }).acceptedObservations === 'number'
          ? {
              acceptedObservations: (body as { acceptedObservations: number }).acceptedObservations,
              idempotent:
                'idempotent' in body && (body as { idempotent?: unknown }).idempotent === true,
            }
          : null;
      if (!response.ok || result === null) {
        setError(errorCode(body, 'deterministic_review_unavailable'));
        return;
      }
      setDeterministicReview(result);
      await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
      setNotice('Review decisions were saved for rows with confirmed matches.');
    } catch {
      setError('deterministic_review_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function designateStagingBaseline() {
    if (detail === null || detail.import.status !== 'committed') {
      setError('committed_import_required_for_baseline');
      return;
    }
    if (!baselineConfirmationRequired) {
      setBaselineConfirmationRequired(true);
      setNotice(
        `Review the applied official import, then confirm the ${baselineYear} staffing baseline below.`,
      );
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setBaselineAcceptance(null);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const response = await csrfFetch(
        `/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/baseline-acceptance`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `baseline-acceptance-${baselineYear}-${detail.import.id}`,
          },
          body: JSON.stringify({
            bid_year: baselineYear,
            supersede_existing: true,
            reason: `Operator-designated ${baselineYear} staffing baseline after reviewed TeleStaff apply.`,
          }),
        },
      );
      const body = await parseResponse(response);
      const result =
        body !== null &&
        typeof body === 'object' &&
        typeof (body as { acceptanceId?: unknown }).acceptanceId === 'string' &&
        typeof (body as { importId?: unknown }).importId === 'string' &&
        typeof (body as { idempotent?: unknown }).idempotent === 'boolean' &&
        (body as { baseline?: unknown }).baseline !== null &&
        typeof (body as { baseline?: unknown }).baseline === 'object' &&
        typeof (body as { baseline: { status?: unknown } }).baseline.status === 'string'
          ? (body as BaselineAcceptanceResult)
          : null;
      if (!response.ok || result === null) {
        setError(errorCode(body, 'baseline_acceptance_unavailable'));
        return;
      }
      setBaselineAcceptance(result);
      await refreshProjections();
      setBaselineConfirmationRequired(false);
      await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
      setNotice(
        result.idempotent
          ? `The existing ${baselineYear} staffing baseline acceptance was confirmed.`
          : result.supersededAcceptanceId === null
            ? `The ${baselineYear} staffing baseline was accepted. Its completeness check is shown below.`
            : `The selected import is now the ${baselineYear} staffing baseline. The previous acceptance remains preserved as superseded history.`,
      );
    } catch {
      setError('baseline_acceptance_unavailable');
    } finally {
      setBusy(false);
    }
  }

  const readyForApply =
    detail?.import.status === 'reviewed' && canonicalEffectiveOn !== '' && !busy;

  return (
    <div className="space-y-6">
      <section
        className="rounded-xl border border-border bg-card p-5"
        aria-labelledby="telestaff-import-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-info">
              Manual source review
            </p>
            <h2 id="telestaff-import-heading" className="mt-1 font-heading text-xl text-foreground">
              Review TeleStaff staffing
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-foreground">
              Choose the report type and the date it reflects. You will choose a separate effective
              date before applying reviewed assignments to Department staffing.
            </p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground">
            Manual upload only
          </span>
        </div>

        <div className="mt-4 border-l-4 border-warning/40 bg-warning-surface px-4 py-3 text-sm text-warning">
          The import history does not retain the original HTML, names, or employee IDs. It keeps a
          privacy-protected review record. This page does not send changes to TeleStaff.
        </div>

        <form
          onSubmit={previewSource}
          data-testid="telestaff-preview-form"
          className="mt-5 grid gap-4 border-t border-border pt-5 lg:grid-cols-2"
        >
          <Label className="block">
            <span className="text-sm text-foreground">Report type</span>
            <NativeSelect
              name="source_kind"
              required
              value={sourceKind}
              onChange={(event) => {
                const nextSourceKind = event.target.value;
                setSourceKind(
                  nextSourceKind === 'official' || nextSourceKind === 'synthetic_test'
                    ? nextSourceKind
                    : '',
                );
                resetPreviewForNewInput();
              }}
              aria-describedby="telestaff-source-kind-help"
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            >
              <option value="" disabled>
                Select the report type
              </option>
              <option value="official">Official TeleStaff source</option>
              <option value="synthetic_test">
                Test report — cannot change Department staffing
              </option>
            </NativeSelect>
            <span
              id="telestaff-source-kind-help"
              className="mt-1 block text-xs text-muted-foreground"
            >
              The report type is saved with the import. Only an official report can be reviewed and
              applied to Department staffing.
            </span>
          </Label>
          <Label className="block">
            <span className="text-sm text-foreground">TeleStaff HTML export</span>
            <Input
              type="file"
              accept="text/html,.html,.htm"
              required
              onChange={(event) => {
                setFile(event.target.files?.item(0) ?? null);
                resetPreviewForNewInput();
              }}
              className="mt-1 block min-h-11 w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground"
            />
          </Label>
          <Label className="block">
            <span className="text-sm text-foreground">Report date</span>
            <Input
              type="date"
              required
              value={sourceSnapshotAsOf}
              onChange={(event) => {
                setSourceSnapshotAsOf(event.target.value);
                resetPreviewForNewInput();
              }}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Label className="block">
            <span className="text-sm text-foreground">How was the report time determined?</span>
            <NativeSelect
              name="source_observation_time_basis"
              value={sourceObservationTimeBasis}
              onChange={(event) => {
                const basis = event.target.value as SourceObservationTimeBasis;
                setSourceObservationTimeBasis(basis);
                if (basis === 'date_only') setSourceObservedAt('');
                resetPreviewForNewInput();
              }}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            >
              <option value="date_only">No exact time in report</option>
              <option value="source_metadata">Time supplied in report</option>
              <option value="administrator_confirmed">Time confirmed by administrator</option>
            </NativeSelect>
          </Label>
          <Label className="block">
            <span className="text-sm text-foreground">Exact report time</span>
            <Input
              name="source_observed_at"
              type="text"
              inputMode="text"
              disabled={sourceObservationTimeBasis === 'date_only'}
              required={sourceObservationTimeBasis !== 'date_only'}
              value={sourceObservedAt}
              placeholder="2026-08-28T14:05:06.789Z"
              aria-describedby="telestaff-source-time-help"
              onChange={(event) => {
                setSourceObservedAt(event.target.value);
                resetPreviewForNewInput();
              }}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span
              id="telestaff-source-time-help"
              className="mt-1 block text-xs text-muted-foreground"
            >
              If an exact time is supplied or confirmed, enter it with a time zone using the format
              shown. Otherwise, choose “No exact time in report.”
            </span>
          </Label>
          <div className="flex flex-wrap gap-3 lg:col-span-2">
            <Button
              type="submit"
              disabled={busy || file === null || sourceKind === '' || sourceSnapshotAsOf === ''}
              className="min-h-11 rounded bg-info px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Previewing…' : 'Preview staffing changes'}
            </Button>
            <Button
              type="button"
              onClick={() => void stageSource()}
              disabled={
                busy ||
                preview === null ||
                file === null ||
                sourceKind === '' ||
                sourceSnapshotAsOf === ''
              }
              className="min-h-11 rounded border border-border px-4 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stage for review
            </Button>
          </div>
        </form>

        {preview !== null && (
          <section
            className="mt-5 rounded-lg border border-border bg-card p-4"
            aria-label="Import preview"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-foreground">Import preview</h3>
              <span className="font-mono text-xs text-foreground">
                {sourceKindLabel(preview.sourceKind)} · Snapshot {preview.sourceSnapshotAsOf}
              </span>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <PreviewMetric label="Report rows" value={preview.normalizedDataRowCount} />
              <PreviewMetric label="People in report" value={preview.uniqueEmployeeCount} />
              <PreviewMetric
                label="Incomplete position details"
                value={preview.incompleteTopologyCount}
                tone="amber"
              />
              <PreviewMetric
                label="Missing A/R day"
                value={preview.missingSourceARDayCount}
                tone="amber"
              />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              This preview shows totals only. Review the individual rows before applying any
              staffing changes.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sourceObservationTimeCopy(
                preview.sourceObservedAt,
                preview.sourceObservationTimeBasis,
              )}
            </p>
          </section>
        )}
      </section>

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive-surface px-4 py-3 text-sm text-destructive"
        >
          {teleStaffErrorCopy(error)}
        </p>
      )}
      {notice !== null && (
        <output
          aria-live="polite"
          className="block rounded border border-info/40 bg-info-surface px-4 py-3 text-sm text-info"
        >
          {notice}
        </output>
      )}

      <section
        className="rounded-xl border border-border bg-card p-5"
        aria-labelledby="telestaff-review-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-info">Review queue</p>
            <h2 id="telestaff-review-heading" className="mt-1 font-heading text-xl text-foreground">
              Reconciliation decisions
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-foreground">
              New or unclear positions require review before a seat can be assigned. An assignment
              is not deleted just because it is missing from the report.
            </p>
          </div>
          {detail !== null && (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${importStatusClass(detail.import.status)}`}
            >
              {detail.import.status}
            </span>
          )}
        </div>

        {detail === null ? (
          <p className="mt-5 rounded border border-border bg-card px-4 py-3 text-sm text-foreground">
            Upload an official report for review, or select a saved import below.
          </p>
        ) : (
          <>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PreviewMetric label="Source rows" value={detail.import.reconciliation.sourceRows} />
              <PreviewMetric
                label="Pending rows"
                value={detail.import.reconciliation.pendingSourceRows}
                tone="amber"
              />
              <PreviewMetric
                label="Hard blockers"
                value={detail.import.reconciliation.hardBlockerSourceRows}
                tone="red"
              />
              <PreviewMetric
                label="Unresolved absences"
                value={detail.import.reconciliation.pendingMissingObservationFindings}
                tone="amber"
              />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Snapshot {detail.import.sourceSnapshotAsOf ?? 'unavailable'} ·{' '}
              {detail.pagination.totalRows} report row(s) in this import.{' '}
              {sourceObservationTimeCopy(
                detail.import.sourceObservedAt,
                detail.import.sourceObservationTimeBasis,
              )}
            </p>
            <a
              data-testid="telestaff-reconciliation-export"
              href={`/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/reconciliation.csv`}
              download
              className="mt-3 inline-flex min-h-10 items-center rounded border border-info/40 px-3 text-sm font-semibold text-info hover:border-info/40 hover:text-foreground"
            >
              Download review summary (CSV)
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              The download contains totals and review outcomes. It excludes the original report,
              names, employee IDs, and private matching details.
            </p>

            <aside
              data-testid="telestaff-next-steps"
              className="mt-4 rounded-lg border border-success/40 bg-success-surface p-4"
            >
              <h3 className="font-semibold text-foreground">Recommended order</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground">
                <li>Confirm clearly identified staffing positions.</li>
                <li>Resolve exceptions that cannot be assigned a seat.</li>
                <li>Accept rows with confirmed matches.</li>
                <li>Confirm zero pending rows, choose the effective date, and apply.</li>
              </ol>
              <p className="mt-2 text-xs text-success">
                The bulk controls process the entire import. Use the row pages below only when an
                individual exception needs review.
              </p>
            </aside>

            {unknownEmployees.length > 0 && (
              <UnknownEmployeeOnboardingPanel
                key={detail.import.id}
                importId={detail.import.id}
                expectedRevision={detail.import.reconciliationRevision}
                employees={unknownEmployees}
                busy={busy}
                onPendingChanges={setOnboardingDirty}
                onError={(code) => setError(code)}
                onComplete={async () => {
                  setUnknownEmployees([]);
                  await refreshProjections();
                  await Promise.all([loadImport(detail.import.id, reviewOffset), loadImports()]);
                  setNotice(
                    'Reviewed personnel records were created or linked by exact Employee ID, then reconciled once.',
                  );
                }}
              />
            )}

            <section
              className="mt-4 rounded-lg border border-info/40 bg-info-surface p-4"
              aria-labelledby="telestaff-certification-heading"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-info">
                Staffing position approval
              </p>
              <h3
                id="telestaff-certification-heading"
                className="mt-1 font-semibold text-foreground"
              >
                Confirm staffing positions
              </h3>
              <p className="mt-2 text-sm text-foreground">
                Creates approved Department staffing positions and saves their confirmed report
                matches. Unclear positions remain unresolved. Personnel assignments are applied in a
                separate step.
              </p>
              <Button
                data-testid="telestaff-certify-deterministic"
                type="button"
                onClick={() => void certifyDeterministicStaffing()}
                disabled={
                  busy || (detail.import.status !== 'staged' && detail.import.status !== 'reviewed')
                }
                className="mt-3 min-h-11 rounded bg-info px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm clearly identified positions
              </Button>

              {certification !== null && (
                <dl
                  data-testid="telestaff-certification-result"
                  className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4"
                >
                  <PreviewMetric
                    label="Requested certifications"
                    value={certification.requestedCertifications}
                  />
                  <PreviewMetric
                    label="Created staffing positions"
                    value={certification.createdCanonicalStaffingPositions}
                  />
                  <PreviewMetric
                    label="Created source mappings"
                    value={certification.createdSourceMappings}
                  />
                  <PreviewMetric
                    label="Already confirmed matches"
                    value={certification.existingIdempotentMatches}
                  />
                  <PreviewMetric
                    label="Unresolved observations"
                    value={certification.unresolvedObservations}
                    tone="amber"
                  />
                  <PreviewMetric
                    label="Conflicting matches skipped"
                    value={certification.skippedCollisions}
                  />
                  <PreviewMetric label="Failures" value={certification.failures.length} />
                  <PreviewMetric
                    label="Review result"
                    value={certification.idempotent ? 'Confirmed' : 'Created'}
                  />
                </dl>
              )}
            </section>

            <section className="mt-4 rounded-lg border border-warning/40 bg-warning-surface p-4">
              <h3 className="font-semibold text-foreground">Safe exception resolution</h3>
              <p className="mt-2 text-sm text-foreground">
                Save review decisions: defer repeated positions without assigning a seat, retain
                incomplete records without creating positions, and reject rows with unknown people
                or unclear position matches. Personnel assignments will not change.
              </p>
              <Button
                data-testid="telestaff-resolve-safe-exceptions"
                type="button"
                onClick={() => void resolveSafeExceptions()}
                disabled={busy || detail.import.reconciliation.pendingSourceRows === 0}
                className="mt-3 min-h-11 rounded border border-warning/40 px-4 text-sm font-semibold text-warning disabled:cursor-not-allowed disabled:opacity-50"
              >
                Resolve import exceptions
              </Button>
              {safeExceptionResolution !== null && (
                <p className="mt-3 text-sm text-warning">
                  Deferred topology: {safeExceptionResolution.deferredRepeatedTopology} · Retained
                  incomplete evidence: {safeExceptionResolution.retainedIncompleteTopology} ·
                  Rejected unknown-person observations:{' '}
                  {safeExceptionResolution.rejectedUnknownPerson} · Rejected ambiguous mappings:{' '}
                  {safeExceptionResolution.rejectedAmbiguousMapping}
                </p>
              )}
            </section>

            <section className="mt-4 rounded-lg border border-info/40 bg-info-surface p-4">
              <h3 className="font-semibold text-foreground">Review confirmed matches</h3>
              <p className="mt-2 text-sm text-foreground">
                Accept all currently safe mapped observations, including rows beyond the first
                review page. Newer protected assignments and unresolved evidence are excluded.
              </p>
              <Button
                type="button"
                data-testid="telestaff-review-deterministic"
                onClick={() => void reviewDeterministicObservations()}
                disabled={busy || detail.import.reconciliation.pendingSourceRows === 0}
                className="mt-3 min-h-11 rounded border border-info/40 px-4 text-sm font-semibold text-info disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept rows with confirmed matches
              </Button>
              {deterministicReview !== null && (
                <p
                  data-testid="telestaff-deterministic-review-result"
                  className="mt-3 text-sm text-info"
                >
                  Accepted observations: {deterministicReview.acceptedObservations} ·{' '}
                  {deterministicReview.idempotent ? 'existing review confirmed' : 'review recorded'}
                </p>
              )}
            </section>

            <div className="mt-4 space-y-3">
              {detail.rows.map((row) => (
                <article key={row.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">
                        Source row {row.sourceRowNumber}:{' '}
                        {row.reconciliationClassification ?? 'Unclassified'}
                      </h3>
                      <p className="mt-1 text-sm text-foreground">
                        {reviewStateCopy(row.reviewState)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Person matched: {row.hasResolvedMember ? 'yes' : 'no'} · Position match
                        approved: {row.hasStaffingPositionSourceMapping ? 'yes' : 'no'} · A/R day:{' '}
                        {row.hasSourceARDay ? 'present' : 'missing'}
                      </p>
                    </div>
                    <span className="rounded border border-border px-2 py-1 text-xs text-foreground">
                      {row.reviewStatus}
                    </span>
                  </div>
                  {row.reviewState === 'CURRENT_RECORD_NEWER_THAN_SOURCE_OBSERVATION' && (
                    <p className="mt-3 border-l-2 border-warning/40 pl-3 text-xs text-warning">
                      A newer staffing record is protected from replacement. Check its approval
                      history before deciding how to handle this row.
                    </p>
                  )}
                  {row.allowedReviewActions.length > 0 && row.reviewStatus === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.allowedReviewActions.map((action) => (
                        <Button
                          key={action}
                          type="button"
                          disabled={busy}
                          onClick={() => void reviewRow(row, action)}
                          className="min-h-10 rounded border border-border px-3 text-xs font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reviewActionLabel(action)}
                        </Button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
            <nav
              aria-label="Reconciliation pages"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2"
            >
              <Button
                type="button"
                data-testid="telestaff-previous-page"
                disabled={busy || reviewOffset === 0}
                onClick={() =>
                  void loadImport(detail.import.id, Math.max(0, reviewOffset - REVIEW_PAGE_SIZE))
                }
                className="min-h-10 rounded border border-border px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous rows
              </Button>
              <span data-testid="telestaff-page-status" className="text-sm text-foreground">
                Page {Math.floor(reviewOffset / REVIEW_PAGE_SIZE) + 1} of{' '}
                {Math.max(1, Math.ceil(detail.pagination.totalRows / REVIEW_PAGE_SIZE))}
              </span>
              <Button
                type="button"
                data-testid="telestaff-next-page"
                disabled={busy || reviewOffset + REVIEW_PAGE_SIZE >= detail.pagination.totalRows}
                onClick={() => void loadImport(detail.import.id, reviewOffset + REVIEW_PAGE_SIZE)}
                className="min-h-10 rounded border border-border px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next rows
              </Button>
            </nav>
          </>
        )}
      </section>

      <section
        className="rounded-xl border border-border bg-card p-5"
        aria-labelledby="telestaff-apply-heading"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Update Department staffing
        </p>
        <h2 id="telestaff-apply-heading" className="mt-1 font-heading text-xl text-foreground">
          Apply reviewed observations
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Choose when the reviewed assignments should take effect. The report date does not set this
          date. Position matches, current assignments, completed reviews, and the report type are
          checked again before any staffing changes are applied.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Label className="block">
            <span className="text-sm text-foreground">Assignment effective date</span>
            <Input
              type="date"
              value={canonicalEffectiveOn}
              onChange={(event) => setCanonicalEffectiveOn(event.target.value)}
              className="mt-1 min-h-11 rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>
          <Button
            type="button"
            onClick={() => void applyCanonical()}
            disabled={!readyForApply}
            className="min-h-11 rounded bg-destructive px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply to Department staffing
          </Button>
        </div>
      </section>

      <section
        className="rounded-xl border border-border bg-card p-5"
        aria-labelledby="telestaff-baseline-heading"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-warning">
          Annual staffing baseline
        </p>
        <h2 id="telestaff-baseline-heading" className="mt-1 font-heading text-xl text-foreground">
          {baselineYear} staffing baseline
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Choose an official import that has already been applied. Its completeness is checked
          before it becomes the staffing baseline. Confirming a new baseline replaces the previous
          choice while preserving its history. Repeating the same confirmation does not create a
          duplicate record.
        </p>
        {baselineConfirmationRequired ? (
          <p className="mt-3 rounded border border-warning/40 bg-warning-surface px-3 py-2 text-sm text-warning">
            This saves the selected import as this year’s production staffing baseline and replaces
            the previous choice, if any. The previous acceptance stays in the history. It does not
            send changes to TeleStaff or start a Bid session.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Label>
            Bid year
            <Input
              type="number"
              min={2024}
              max={2100}
              value={baselineYear}
              disabled={busy}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 2024 && value <= 2100) {
                  setBaselineYear(value);
                  setBaselineConfirmationRequired(false);
                  setBaselineAcceptance(null);
                }
              }}
            />
          </Label>
          <Button
            type="button"
            data-testid="telestaff-baseline-acceptance"
            onClick={() => void designateStagingBaseline()}
            disabled={detail?.import.status !== 'committed' || busy}
            className="min-h-11 rounded bg-warning px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {baselineConfirmationRequired
              ? `Confirm ${baselineYear} staffing baseline`
              : `Designate ${baselineYear} staffing baseline`}
          </Button>
          {baselineAcceptance !== null && (
            <div
              data-testid="telestaff-baseline-result"
              className="rounded border border-success/40 bg-success-surface px-3 py-2 text-sm text-success"
            >
              Completeness: {baselineAcceptance.baseline.status} ·{' '}
              {baselineAcceptance.idempotent
                ? 'existing acceptance confirmed'
                : baselineAcceptance.supersededAcceptanceId === null
                  ? 'acceptance recorded'
                  : 'previous acceptance superseded'}
            </div>
          )}
        </div>
      </section>

      <section
        className="rounded-xl border border-border bg-card p-5"
        aria-labelledby="telestaff-history-heading"
      >
        <h2 id="telestaff-history-heading" className="font-heading text-xl text-foreground">
          Import history
        </h2>
        <p className="mt-2 text-sm text-foreground">
          Select a saved import to review its status and decisions.
        </p>
        <div className="mt-4 space-y-2">
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No retained imports are available.</p>
          ) : (
            imports.map((item) => (
              <Button
                key={item.id}
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setUnknownEmployees([]);
                  void loadImport(item.id);
                }}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-border bg-card px-3 py-3 text-left text-sm hover:border-border"
              >
                <span className="text-foreground">
                  {sourceKindLabel(item.sourceKind)} · Snapshot{' '}
                  {item.sourceSnapshotAsOf ?? 'unavailable'} · {item.reconciliation.sourceRows}{' '}
                  row(s) ·{' '}
                  {sourceObservationTimeCopy(
                    item.sourceObservedAt,
                    item.sourceObservationTimeBasis,
                  )}
                </span>
                <span
                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${importStatusClass(item.status)}`}
                >
                  {item.status}
                </span>
              </Button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function PreviewMetric({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number | string;
  tone?: 'slate' | 'amber' | 'red';
}) {
  const valueClass =
    tone === 'red' ? 'text-destructive' : tone === 'amber' ? 'text-warning' : 'text-foreground';
  return (
    <div className="rounded border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}
