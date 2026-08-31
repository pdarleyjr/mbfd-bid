'use client';

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

function errorCode(body: unknown, fallback: string): string {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const value = (body as ApiError).error;
    if (typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value)) return value;
  }
  return fallback;
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
      return 'Newer protected canonical record';
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
  if (status === 'committed') return 'border-emerald-700 bg-emerald-950/40 text-emerald-100';
  if (status === 'reviewed') return 'border-sky-700 bg-sky-950/40 text-sky-100';
  if (status === 'rejected') return 'border-slate-600 bg-slate-900 text-slate-200';
  return 'border-amber-700 bg-amber-950/40 text-amber-100';
}

function sourceObservationTimeCopy(
  sourceObservedAt: number | null | undefined,
  basis: SourceObservationTimeBasis | undefined,
): string {
  if (sourceObservedAt === null || sourceObservedAt === undefined || basis === 'date_only') {
    return 'Date-only source evidence; no exact time was fabricated.';
  }
  const timestamp = new Date(sourceObservedAt);
  if (!Number.isFinite(timestamp.getTime())) return 'Exact source time is unavailable.';
  const label = basis === 'source_metadata' ? 'Source metadata' : 'Administrator confirmed';
  return `${label}: ${timestamp.toISOString()}`;
}

function sourceKindLabel(sourceKind: ImportSummary['sourceKind'] | Preview['sourceKind']): string {
  switch (sourceKind) {
    case 'official':
      return 'Official source';
    case 'synthetic_test':
      return 'Synthetic test source — cannot affect canonical staffing';
    case 'legacy_unclassified':
      return 'Legacy unclassified source — cannot affect canonical staffing';
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

/**
 * Intentionally displays only aggregate and reconciliation metadata. The selected
 * HTML File remains browser-memory input; source names and identifiers are never
 * rendered or stored in component state.
 */
export function TeleStaffOperatorWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<TeleStaffSourceKind | ''>('');
  const [sourceSnapshotAsOf, setSourceSnapshotAsOf] = useState('');
  const [sourceObservedAt, setSourceObservedAt] = useState('');
  const [sourceObservationTimeBasis, setSourceObservationTimeBasis] =
    useState<SourceObservationTimeBasis>('date_only');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [canonicalEffectiveOn, setCanonicalEffectiveOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [certification, setCertification] = useState<CertificationResult | null>(null);

  async function loadImport(importId: string): Promise<ImportDetail | null> {
    const response = await fetch(`/api/admin/telestaff/imports/${encodeURIComponent(importId)}`, {
      credentials: 'include',
    });
    const body = await parseResponse(response);
    if (!response.ok || body === null || typeof body !== 'object') {
      setError(errorCode(body, 'import_detail_unavailable'));
      return null;
    }
    const loaded = body as ImportDetail;
    setDetail(loaded);
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
      await Promise.all([loadImport(importId), loadImports()]);
      setPreview(null);
      setNotice(
        response.status === 202
          ? 'The sanitized import was retained for review; it cannot affect canonical staffing.'
          : 'The sanitized import is staged for reconciliation review.',
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
      await Promise.all([loadImport(detail.import.id), loadImports()]);
      setNotice('Controlled review resolution recorded. Canonical staffing remains unchanged.');
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
      await Promise.all([loadImport(detail.import.id), loadImports()]);
      setNotice('Canonical staffing was updated only for reviewed, deterministic observations.');
    } catch {
      setError('canonical_apply_unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function certifyDeterministicStaffing() {
    if (detail === null) return;
    const confirmed = window.confirm(
      'Apply 213 deterministic staffing certifications?\n\n' +
        'Six repeated Marine Float observations will remain unresolved because the source has no safe seat discriminator. This uses the staging portal only: no direct D1 writes and no production mutation.',
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
      await Promise.all([loadImport(detail.import.id), loadImports()]);
      setNotice(
        result.idempotent
          ? 'No duplicate canonical staffing was created; the prior deterministic certification was confirmed.'
          : 'Deterministic staffing certification was recorded with the server-calculated result below.',
      );
    } catch {
      setError('staffing_certification_unavailable');
    } finally {
      setBusy(false);
    }
  }

  const readyForApply =
    detail?.import.status === 'reviewed' && canonicalEffectiveOn !== '' && !busy;

  return (
    <div className="space-y-6">
      <section
        className="rounded-xl border border-slate-700 bg-slate-800/60 p-5"
        aria-labelledby="telestaff-import-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              Manual source review
            </p>
            <h2 id="telestaff-import-heading" className="mt-1 font-heading text-xl text-white">
              Sanitized TeleStaff reconciliation
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Select the declared source kind and an explicit source snapshot date. The snapshot
              date records when the source was observed; it is not a canonical assignment effective
              date.
            </p>
          </div>
          <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200">
            Manual upload only
          </span>
        </div>

        <div className="mt-4 border-l-4 border-amber-500 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          No raw HTML, names, or employee IDs are retained. The server stores only sanitized,
          irreversible reconciliation evidence; it never contacts or writes back to TeleStaff.
        </div>

        <form
          onSubmit={previewSource}
          data-testid="telestaff-preview-form"
          className="mt-5 grid gap-4 border-t border-slate-700 pt-5 lg:grid-cols-2"
        >
          <label className="block">
            <span className="text-sm text-slate-200">Source kind declaration</span>
            <select
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
              className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
            >
              <option value="" disabled>
                Select the source declaration
              </option>
              <option value="official">Official TeleStaff source</option>
              <option value="synthetic_test">Synthetic test source — never canonical</option>
            </select>
            <span id="telestaff-source-kind-help" className="mt-1 block text-xs text-slate-400">
              This declaration is retained with the sanitized import provenance. Only an official
              source can reach the separately controlled canonical-apply review.
            </span>
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">TeleStaff HTML export</span>
            <input
              type="file"
              accept="text/html,.html,.htm"
              required
              onChange={(event) => {
                setFile(event.target.files?.item(0) ?? null);
                resetPreviewForNewInput();
              }}
              className="mt-1 block min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">Source snapshot as of</span>
            <input
              type="date"
              required
              value={sourceSnapshotAsOf}
              onChange={(event) => {
                setSourceSnapshotAsOf(event.target.value);
                resetPreviewForNewInput();
              }}
              className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">Source observation time basis</span>
            <select
              name="source_observation_time_basis"
              value={sourceObservationTimeBasis}
              onChange={(event) => {
                const basis = event.target.value as SourceObservationTimeBasis;
                setSourceObservationTimeBasis(basis);
                if (basis === 'date_only') setSourceObservedAt('');
                resetPreviewForNewInput();
              }}
              className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
            >
              <option value="date_only">date_only — report has no exact time</option>
              <option value="source_metadata">source_metadata — supplied by the source</option>
              <option value="administrator_confirmed">
                administrator_confirmed — verified by operator
              </option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">Exact source observation time</span>
            <input
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
              className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span id="telestaff-source-time-help" className="mt-1 block text-xs text-slate-400">
              Optional only with source_metadata or administrator_confirmed. Enter strict RFC3339
              with a timezone; date-only evidence intentionally has no exact timestamp.
            </span>
          </label>
          <div className="flex flex-wrap gap-3 lg:col-span-2">
            <button
              type="submit"
              disabled={busy || file === null || sourceKind === '' || sourceSnapshotAsOf === ''}
              className="min-h-11 rounded bg-sky-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Previewing…' : 'Preview sanitized reconciliation'}
            </button>
            <button
              type="button"
              onClick={() => void stageSource()}
              disabled={
                busy ||
                preview === null ||
                file === null ||
                sourceKind === '' ||
                sourceSnapshotAsOf === ''
              }
              className="min-h-11 rounded border border-slate-500 px-4 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stage for review
            </button>
          </div>
        </form>

        {preview !== null && (
          <section
            className="mt-5 rounded-lg border border-slate-700 bg-slate-950/50 p-4"
            aria-label="Sanitized preview"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-white">Sanitized preview</h3>
              <span className="font-mono text-xs text-slate-300">
                {sourceKindLabel(preview.sourceKind)} · Snapshot {preview.sourceSnapshotAsOf}
              </span>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <PreviewMetric label="Normalized rows" value={preview.normalizedDataRowCount} />
              <PreviewMetric label="Unique source identities" value={preview.uniqueEmployeeCount} />
              <PreviewMetric
                label="Incomplete topology"
                value={preview.incompleteTopologyCount}
                tone="amber"
              />
              <PreviewMetric
                label="Missing A/R day"
                value={preview.missingSourceARDayCount}
                tone="amber"
              />
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              Parser {preview.parserVersion}; source format {preview.sourceFormat}. This is
              aggregate evidence only—review staging separately before any canonical action.
            </p>
            <p className="mt-1 text-xs text-slate-400">
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
          className="rounded border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-100"
        >
          The requested operation was not completed: {error.replaceAll('_', ' ')}.
        </p>
      )}
      {notice !== null && (
        <output
          aria-live="polite"
          className="block rounded border border-sky-700 bg-sky-950/40 px-4 py-3 text-sm text-sky-100"
        >
          {notice}
        </output>
      )}

      <section
        className="rounded-xl border border-slate-700 bg-slate-800/60 p-5"
        aria-labelledby="telestaff-review-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              Review queue
            </p>
            <h2 id="telestaff-review-heading" className="mt-1 font-heading text-xl text-white">
              Reconciliation decisions
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Decisions are constrained by the server. Ambiguous and new topology rows never choose
              a canonical slot automatically, and an absent source row never deletes an assignment.
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
          <p className="mt-5 rounded border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
            Stage a sanitized official export, or select a retained import below, to load its review
            queue.
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
            <p className="mt-3 text-xs text-slate-400">
              Snapshot {detail.import.sourceSnapshotAsOf ?? 'unavailable'} ·{' '}
              {detail.pagination.totalRows} sanitized source row(s) in this import.{' '}
              {sourceObservationTimeCopy(
                detail.import.sourceObservedAt,
                detail.import.sourceObservationTimeBasis,
              )}
            </p>
            <a
              data-testid="telestaff-reconciliation-export"
              href={`/api/admin/telestaff/imports/${encodeURIComponent(detail.import.id)}/reconciliation.csv`}
              download
              className="mt-3 inline-flex min-h-10 items-center rounded border border-sky-600 px-3 text-sm font-semibold text-sky-100 hover:border-sky-400 hover:text-white"
            >
              Download sanitized reconciliation CSV
            </a>
            <p className="mt-2 text-xs text-slate-400">
              The download contains only aggregate evidence and safe review classifications; it
              omits raw HTML, source locators, mappings, names, employee IDs, and HMAC values.
            </p>

            <section
              className="mt-4 rounded-lg border border-sky-700 bg-sky-950/30 p-4"
              aria-labelledby="telestaff-certification-heading"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
                Staging certification
              </p>
              <h3 id="telestaff-certification-heading" className="mt-1 font-semibold text-white">
                Deterministic staffing positions
              </h3>
              <p className="mt-2 text-sm text-slate-300">
                The approved staging operation certifies 213 unique complete source tuples. Six
                repeated Marine Float observations remain unresolved because the source has no safe
                seat discriminator. It uses the authenticated staging API—never a direct D1 write or
                a production mutation.
              </p>
              <button
                data-testid="telestaff-certify-deterministic"
                type="button"
                onClick={() => void certifyDeterministicStaffing()}
                disabled={
                  busy || (detail.import.status !== 'staged' && detail.import.status !== 'reviewed')
                }
                className="mt-3 min-h-11 rounded bg-sky-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Certify deterministic staffing positions
              </button>

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
                    label="Existing/idempotent matches"
                    value={certification.existingIdempotentMatches}
                  />
                  <PreviewMetric
                    label="Unresolved observations"
                    value={certification.unresolvedObservations}
                    tone="amber"
                  />
                  <PreviewMetric
                    label="Skipped collisions"
                    value={certification.skippedCollisions}
                  />
                  <PreviewMetric label="Failures" value={certification.failures.length} />
                  <PreviewMetric
                    label="Replay result"
                    value={certification.idempotent ? 'Confirmed' : 'Created'}
                  />
                </dl>
              )}
            </section>

            <div className="mt-4 space-y-3">
              {detail.rows.map((row) => (
                <article
                  key={row.id}
                  className="rounded-lg border border-slate-700 bg-slate-950/50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">
                        Source row {row.sourceRowNumber}:{' '}
                        {row.reconciliationClassification ?? 'Unclassified'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-300">
                        {reviewStateCopy(row.reviewState)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Identity resolved: {row.hasResolvedMember ? 'yes' : 'no'} · Approved mapping
                        context: {row.hasStaffingPositionSourceMapping ? 'yes' : 'no'} · A/R day:{' '}
                        {row.hasSourceARDay ? 'present' : 'missing'}
                      </p>
                    </div>
                    <span className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200">
                      {row.reviewStatus}
                    </span>
                  </div>
                  {row.reviewState === 'CURRENT_RECORD_NEWER_THAN_SOURCE_OBSERVATION' && (
                    <p className="mt-3 border-l-2 border-amber-400 pl-3 text-xs text-amber-100">
                      A newer protected canonical record exists. This interface does not claim that
                      record is approved; approval provenance requires dedicated audit data.
                    </p>
                  )}
                  {row.allowedReviewActions.length > 0 && row.reviewStatus === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.allowedReviewActions.map((action) => (
                        <button
                          key={action}
                          type="button"
                          disabled={busy}
                          onClick={() => void reviewRow(row, action)}
                          className="min-h-10 rounded border border-slate-500 px-3 text-xs font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reviewActionLabel(action)}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section
        className="rounded-xl border border-slate-700 bg-slate-800/60 p-5"
        aria-labelledby="telestaff-apply-heading"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
          Controlled canonical action
        </p>
        <h2 id="telestaff-apply-heading" className="mt-1 font-heading text-xl text-white">
          Apply reviewed observations
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          A canonical effective date is always chosen explicitly and is never inferred from the
          source snapshot. The server rechecks mappings, current assignments, terminal review state,
          and source type immediately before mutation.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-sm text-slate-200">Canonical effective date</span>
            <input
              type="date"
              value={canonicalEffectiveOn}
              onChange={(event) => setCanonicalEffectiveOn(event.target.value)}
              className="mt-1 min-h-11 rounded border border-slate-600 bg-slate-950 px-3 text-white"
            />
          </label>
          <button
            type="button"
            onClick={() => void applyCanonical()}
            disabled={!readyForApply}
            className="min-h-11 rounded bg-red-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply to canonical staffing
          </button>
        </div>
      </section>

      <section
        className="rounded-xl border border-slate-700 bg-slate-800/60 p-5"
        aria-labelledby="telestaff-history-heading"
      >
        <h2 id="telestaff-history-heading" className="font-heading text-xl text-white">
          Sanitized import history
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Select a retained import to inspect its metadata-only reconciliation state.
        </p>
        <div className="mt-4 space-y-2">
          {imports.length === 0 ? (
            <p className="text-sm text-slate-400">No retained imports are available.</p>
          ) : (
            imports.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  void loadImport(item.id);
                }}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-slate-700 bg-slate-950/50 px-3 py-3 text-left text-sm hover:border-slate-500"
              >
                <span className="text-slate-100">
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
              </button>
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
    tone === 'red' ? 'text-red-200' : tone === 'amber' ? 'text-amber-200' : 'text-white';
  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}
