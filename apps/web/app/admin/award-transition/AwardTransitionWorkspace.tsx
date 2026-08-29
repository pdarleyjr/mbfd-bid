'use client';

import { type FormEvent, useMemo, useState } from 'react';

/**
 * Human-readable evidence gathered by the server from authenticated admin
 * views. The internal session key remains an implementation detail of the
 * session-controls link that opened this workspace.
 */
export interface AwardTransitionOperatorContext {
  sessionId: string;
  sessionLabel: string;
  members: Readonly<Record<number, string>>;
  bidPositions: Readonly<Record<string, string>>;
  staffingPositions: Readonly<Record<string, string>>;
}

interface CurrentAssignment {
  id: string;
  staffingPositionId: string;
  status: 'active';
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface CurrentToNewAssignment {
  ordinal: number;
  awardId: string;
  memberId: number;
  positionId: string;
  currentAssignment: CurrentAssignment | null;
  newAssignment: {
    staffingPositionId: string;
    effectiveFrom: string;
    originRef: string;
    status: 'planned';
  };
}

interface TransitionPreview {
  bidSessionId: string;
  asOfDate: string;
  effectiveOn: string;
  assignmentClosures: Array<{
    id: string;
    memberId: number;
    staffingPositionId: string;
    status: 'active';
    effectiveTo: string;
  }>;
  plannedAssignments: Array<{
    awardId: string;
    memberId: number;
    positionId: string;
    staffingPositionId: string;
    originType: 'BID_AWARD';
    originRef: string;
    status: 'planned';
    effectiveFrom: string;
    effectiveTo: null;
  }>;
  currentToNew: CurrentToNewAssignment[];
}

interface TransitionReceipt {
  replayed: boolean;
  effectiveOn: string;
  createdAssignments: number | null;
  lifecycleEventIds: string[];
  portalWriteback: 'not_enqueued' | null;
}

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ApiRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asSafePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isFutureUtcDate(value: string): boolean {
  return isIsoDate(value) && value > new Date().toISOString().slice(0, 10);
}

function parseCurrentAssignment(value: unknown): CurrentAssignment | null | undefined {
  if (value === null) return null;
  const row = asRecord(value);
  if (
    row === null ||
    asString(row.id) === null ||
    asString(row.staffingPositionId) === null ||
    row.status !== 'active' ||
    asString(row.effectiveFrom) === null ||
    (row.effectiveTo !== null && asString(row.effectiveTo) === null)
  ) {
    return undefined;
  }
  return {
    id: row.id as string,
    staffingPositionId: row.staffingPositionId as string,
    status: 'active',
    effectiveFrom: row.effectiveFrom as string,
    effectiveTo: row.effectiveTo as string | null,
  };
}

function parseCurrentToNew(value: unknown): CurrentToNewAssignment | null {
  const row = asRecord(value);
  if (row === null) return null;
  const currentAssignment = parseCurrentAssignment(row.currentAssignment);
  const newAssignment = asRecord(row.newAssignment);
  if (
    asSafePositiveInteger(row.ordinal) === null ||
    asString(row.awardId) === null ||
    asSafePositiveInteger(row.memberId) === null ||
    asString(row.positionId) === null ||
    currentAssignment === undefined ||
    newAssignment === null ||
    asString(newAssignment.staffingPositionId) === null ||
    asString(newAssignment.effectiveFrom) === null ||
    asString(newAssignment.originRef) === null ||
    newAssignment.status !== 'planned'
  ) {
    return null;
  }
  return {
    ordinal: row.ordinal as number,
    awardId: row.awardId as string,
    memberId: row.memberId as number,
    positionId: row.positionId as string,
    currentAssignment,
    newAssignment: {
      staffingPositionId: newAssignment.staffingPositionId as string,
      effectiveFrom: newAssignment.effectiveFrom as string,
      originRef: newAssignment.originRef as string,
      status: 'planned',
    },
  };
}

function parseClosure(value: unknown): TransitionPreview['assignmentClosures'][number] | null {
  const row = asRecord(value);
  if (
    row === null ||
    asString(row.id) === null ||
    asSafePositiveInteger(row.memberId) === null ||
    asString(row.staffingPositionId) === null ||
    row.status !== 'active' ||
    asString(row.effectiveTo) === null
  ) {
    return null;
  }
  return {
    id: row.id as string,
    memberId: row.memberId as number,
    staffingPositionId: row.staffingPositionId as string,
    status: 'active',
    effectiveTo: row.effectiveTo as string,
  };
}

function parsePlannedAssignment(
  value: unknown,
): TransitionPreview['plannedAssignments'][number] | null {
  const row = asRecord(value);
  if (
    row === null ||
    asString(row.awardId) === null ||
    asSafePositiveInteger(row.memberId) === null ||
    asString(row.positionId) === null ||
    asString(row.staffingPositionId) === null ||
    row.originType !== 'BID_AWARD' ||
    asString(row.originRef) === null ||
    row.status !== 'planned' ||
    asString(row.effectiveFrom) === null ||
    row.effectiveTo !== null
  ) {
    return null;
  }
  return {
    awardId: row.awardId as string,
    memberId: row.memberId as number,
    positionId: row.positionId as string,
    staffingPositionId: row.staffingPositionId as string,
    originType: 'BID_AWARD',
    originRef: row.originRef as string,
    status: 'planned',
    effectiveFrom: row.effectiveFrom as string,
    effectiveTo: null,
  };
}

function parsePreview(value: unknown): TransitionPreview | null {
  const response = asRecord(value);
  const transition = response === null ? null : asRecord(response.transition);
  if (transition === null) return null;
  const currentToNewRaw = transition.currentToNew;
  const closures = transition.assignmentClosures;
  const planned = transition.plannedAssignments;
  if (!Array.isArray(currentToNewRaw) || !Array.isArray(closures) || !Array.isArray(planned))
    return null;
  const currentToNew = currentToNewRaw.map(parseCurrentToNew);
  const parsedClosures = closures.map(parseClosure);
  const parsedPlanned = planned.map(parsePlannedAssignment);
  if (
    currentToNew.length === 0 ||
    currentToNew.some((entry) => entry === null) ||
    parsedClosures.some((entry) => entry === null) ||
    parsedPlanned.some((entry) => entry === null) ||
    parsedPlanned.length !== currentToNew.length
  ) {
    return null;
  }
  if (
    asString(transition.bidSessionId) === null ||
    asString(transition.asOfDate) === null ||
    asString(transition.effectiveOn) === null
  ) {
    return null;
  }
  return {
    bidSessionId: transition.bidSessionId as string,
    asOfDate: transition.asOfDate as string,
    effectiveOn: transition.effectiveOn as string,
    assignmentClosures: parsedClosures as TransitionPreview['assignmentClosures'],
    plannedAssignments: parsedPlanned as TransitionPreview['plannedAssignments'],
    currentToNew: currentToNew as CurrentToNewAssignment[],
  };
}

function parseReceipt(value: unknown): TransitionReceipt | null {
  const response = asRecord(value);
  if (
    response === null ||
    typeof response.replayed !== 'boolean' ||
    asString(response.effectiveOn) === null ||
    !Array.isArray(response.lifecycleEventIds) ||
    response.lifecycleEventIds.length === 0 ||
    !response.lifecycleEventIds.every((id) => asString(id) !== null)
  ) {
    return null;
  }
  const createdAssignments =
    response.createdAssignments === undefined
      ? null
      : asSafePositiveInteger(response.createdAssignments);
  if (response.createdAssignments !== undefined && createdAssignments === null) return null;
  return {
    replayed: response.replayed,
    effectiveOn: response.effectiveOn as string,
    createdAssignments,
    lifecycleEventIds: response.lifecycleEventIds as string[],
    portalWriteback: response.portalWriteback === 'not_enqueued' ? 'not_enqueued' : null,
  };
}

function apiError(body: unknown, fallback: string): string {
  const response = asRecord(body);
  const error = response === null ? null : asString(response.error);
  const policyError = response === null ? null : asString(response.policy_error);
  if (error === null) return fallback;
  return policyError === null
    ? `Transition blocked: ${error}.`
    : `Transition blocked: ${error} (${policyError}).`;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `award-transition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function memberLabel(context: AwardTransitionOperatorContext, memberId: number): string {
  return context.members[memberId] ?? 'Member unavailable in the reviewed roster';
}

function bidPositionLabel(context: AwardTransitionOperatorContext, positionId: string): string {
  return context.bidPositions[positionId] ?? 'Bid position unavailable in the immutable snapshot';
}

function staffingPositionLabel(
  context: AwardTransitionOperatorContext,
  positionId: string,
): string {
  return (
    context.staffingPositions[positionId] ?? 'Staffing position unavailable in the reviewed roster'
  );
}

function assignmentLabel(
  context: AwardTransitionOperatorContext,
  assignment: CurrentAssignment | null,
): string {
  if (assignment === null) return 'No active staffing assignment';
  const through = assignment.effectiveTo === null ? 'onward' : `through ${assignment.effectiveTo}`;
  return `${staffingPositionLabel(context, assignment.staffingPositionId)} · ${assignment.status} · ${assignment.effectiveFrom} ${through}`;
}

export function AwardTransitionWorkspace({
  operatorContext,
  selectionError = null,
}: {
  operatorContext: AwardTransitionOperatorContext | null;
  selectionError?: string | null;
}) {
  const [effectiveOn, setEffectiveOn] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<TransitionPreview | null>(null);
  const [receipt, setReceipt] = useState<TransitionReceipt | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();
  const previewMatchesInput =
    preview !== null &&
    operatorContext !== null &&
    preview.bidSessionId === operatorContext.sessionId &&
    preview.effectiveOn === effectiveOn;
  const canPreview = operatorContext !== null && isFutureUtcDate(effectiveOn);
  const canApply =
    previewMatchesInput &&
    trimmedReason.length >= 4 &&
    trimmedReason.length <= 500 &&
    confirmed &&
    !previewBusy &&
    !applyBusy;
  const transitionCsvHref = useMemo(() => {
    if (!previewMatchesInput || preview === null) return null;
    return `/api/admin/bid-award-transition/${encodeURIComponent(preview.bidSessionId)}/transition.csv?effective_on=${encodeURIComponent(preview.effectiveOn)}`;
  }, [preview, previewMatchesInput]);

  function invalidatePreview() {
    setPreview(null);
    setReceipt(null);
    setConfirmed(false);
    setIdempotencyKey(null);
  }

  async function previewTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setReceipt(null);
    if (operatorContext === null || !canPreview) {
      setPreview(null);
      setError(
        'Select a completed Bid from its session controls and choose a future UTC effective date before requesting a preview.',
      );
      return;
    }

    setPreviewBusy(true);
    try {
      const response = await fetch(
        `/api/admin/bid-award-transition/${encodeURIComponent(operatorContext.sessionId)}/preview?effective_on=${encodeURIComponent(effectiveOn)}`,
        { credentials: 'include' },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setPreview(null);
        setError(apiError(body, `Transition preview failed (${response.status}).`));
        return;
      }
      const nextPreview = parsePreview(body);
      if (
        nextPreview === null ||
        nextPreview.bidSessionId !== operatorContext.sessionId ||
        nextPreview.effectiveOn !== effectiveOn
      ) {
        setPreview(null);
        setError(
          'Transition preview returned incomplete or mismatched evidence. No application is enabled.',
        );
        return;
      }
      setPreview(nextPreview);
      setConfirmed(false);
      setIdempotencyKey(null);
    } catch (caught) {
      setPreview(null);
      setError(
        caught instanceof Error ? caught.message : 'Transition preview could not be reached.',
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  async function applyTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!canApply || preview === null) {
      setError(
        'A matching reviewed preview, a 4–500 character reason, and explicit confirmation are required.',
      );
      return;
    }

    const nextIdempotencyKey = idempotencyKey ?? createIdempotencyKey();
    setIdempotencyKey(nextIdempotencyKey);
    setApplyBusy(true);
    try {
      const response = await fetch(
        `/api/admin/bid-award-transition/${encodeURIComponent(preview.bidSessionId)}/apply`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': nextIdempotencyKey,
          },
          body: JSON.stringify({ effective_on: preview.effectiveOn, reason: trimmedReason }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(apiError(body, `Transition application failed (${response.status}).`));
        return;
      }
      const nextReceipt = parseReceipt(body);
      if (nextReceipt === null || nextReceipt.effectiveOn !== preview.effectiveOn) {
        setError(
          'The service accepted the request but returned incomplete transition receipt evidence.',
        );
        return;
      }
      setReceipt(nextReceipt);
      setConfirmed(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Transition application could not be reached. Retry with the same idempotency key.',
      );
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="award-transition-heading">
      <header className="border-b border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
          Effective-dated staffing control
        </p>
        <h1 id="award-transition-heading" className="mt-1 font-heading text-3xl text-white">
          Award transition
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Convert one completed, immutable Bid into future staffing assignments only after reviewing
          the canonical current-to-new plan. This screen does not create awards or alter Bid policy.
        </p>
      </header>

      <section className="rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-sm text-amber-100">
        <h2 className="font-semibold text-amber-50">Fail-closed transition boundary</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
          <li>Preview is read-only; it does not create or close a staffing assignment.</li>
          <li>Mock sessions are blocked. A complete, immutable Bid snapshot is required.</li>
          <li>
            The Worker independently rejects incomplete awards, unapproved position bindings,
            occupancy conflicts, stale state, and non-future dates.
          </li>
          <li>
            Application requires a recorded reason, idempotency key, and protected admin action.
          </li>
        </ul>
      </section>

      {operatorContext === null ? (
        <section
          data-testid="award-transition-session-required"
          className="rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-sm text-amber-100"
        >
          <h2 className="font-semibold">Select a completed Bid from its session controls</h2>
          <p className="mt-1 max-w-3xl text-amber-100/90">
            This protected workflow uses the session you selected from its operator controls. It
            will not accept a copied internal session identifier.
          </p>
          {selectionError !== null && <p className="mt-3 text-amber-100/90">{selectionError}</p>}
        </section>
      ) : (
        <form
          data-testid="award-transition-preview-form"
          onSubmit={previewTransition}
          className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-64 flex-1">
              <p className="text-sm font-medium text-slate-200">Selected completed Bid</p>
              <p className="mt-1 text-sm text-sky-100">{operatorContext.sessionLabel}</p>
              <p className="mt-1 text-xs text-slate-400">
                Return to the session controls to select a different completed Bid.
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Future effective date</span>
              <input
                required
                type="date"
                value={effectiveOn}
                onChange={(event) => {
                  setEffectiveOn(event.target.value);
                  invalidatePreview();
                }}
                className="mt-1 block min-h-11 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Validated again by the Worker in UTC.
              </span>
            </label>
            <button
              type="submit"
              disabled={!canPreview || previewBusy || applyBusy}
              className="min-h-11 rounded border border-sky-700 bg-sky-950/40 px-4 py-2 text-sm font-semibold text-sky-100 hover:border-sky-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewBusy ? 'Loading preview…' : 'Preview transition'}
            </button>
          </div>
        </form>
      )}

      {error !== null && (
        <output
          aria-live="polite"
          className="block rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-100"
        >
          {error}
        </output>
      )}

      {operatorContext !== null && preview !== null && previewMatchesInput && (
        <>
          <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/40">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Read-only canonical plan
                </p>
                <h2 className="mt-1 font-heading text-xl text-white">Current-to-new assignments</h2>
                <p className="mt-1 text-sm text-slate-300">
                  As of {preview.asOfDate}; proposed staffing takes effect on {preview.effectiveOn}.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-800 bg-sky-950/30 px-3 py-1 text-xs font-semibold text-sky-100">
                  {preview.plannedAssignments.length} planned
                </span>
                <span className="rounded-full border border-amber-800 bg-amber-950/30 px-3 py-1 text-xs font-semibold text-amber-100">
                  {preview.assignmentClosures.length} current assignment
                  {preview.assignmentClosures.length === 1 ? '' : 's'} close the prior day
                </span>
                {transitionCsvHref !== null && (
                  <a
                    data-testid="award-transition-csv"
                    href={transitionCsvHref}
                    className="inline-flex min-h-9 items-center rounded border border-slate-600 px-3 text-xs font-semibold text-slate-100 hover:border-slate-300 hover:text-white"
                  >
                    Download transition CSV
                  </a>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[72rem] text-left text-sm">
                <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Award</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Bid position</th>
                    <th className="px-4 py-3">Current staffing</th>
                    <th className="px-4 py-3">New staffing</th>
                    <th className="px-5 py-3">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {preview.currentToNew.map((row) => (
                    <tr key={row.awardId} className="align-top text-slate-200">
                      <td className="px-5 py-3">
                        <p className="font-medium text-white">Award {row.ordinal}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        {memberLabel(operatorContext, row.memberId)}
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        {bidPositionLabel(operatorContext, row.positionId)}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {assignmentLabel(operatorContext, row.currentAssignment)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-sky-100">
                          {staffingPositionLabel(
                            operatorContext,
                            row.newAssignment.staffingPositionId,
                          )}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          planned from {row.newAssignment.effectiveFrom}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-400">
                        Immutable completed-Bid award evidence
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <form
            data-testid="award-transition-apply-form"
            onSubmit={applyTransition}
            className="rounded-xl border border-red-800/80 bg-red-950/20 p-5"
            aria-describedby="award-transition-apply-help"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-red-200">
                  Protected action
                </p>
                <h2 className="mt-1 font-heading text-xl text-white">Apply reviewed transition</h2>
                <p
                  id="award-transition-apply-help"
                  className="mt-1 max-w-3xl text-sm text-slate-300"
                >
                  The Worker revalidates this plan immediately before its atomic effective-dated
                  write. Step-up confirmation may be requested before the application proceeds.
                </p>
              </div>
              <p className="max-w-sm border-l-2 border-amber-500 pl-3 text-xs leading-5 text-amber-100">
                A receipt must explicitly state that portal writeback is not enqueued. Missing
                receipt evidence remains an operator follow-up, not a completion claim.
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="block lg:col-span-2">
                <span className="text-sm font-medium text-slate-200">Operator reason</span>
                <textarea
                  required
                  minLength={4}
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReceipt(null);
                    setIdempotencyKey(null);
                  }}
                  placeholder="Record why this completed Bid should become future staffing on the selected date."
                  className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white placeholder:text-slate-500"
                />
                <span className="mt-1 block text-xs text-slate-400">
                  4–500 characters; retained with transition audit evidence.
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3 rounded border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-950 text-red-700 focus:ring-red-500"
                />
                <span>
                  I confirm this reviewed preview should create future staffing assignments and
                  close only the shown prior assignments on the preceding day.
                </span>
              </label>
              <div className="rounded border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300">
                <p className="font-medium text-slate-100">Idempotency key</p>
                <p className="mt-1 font-mono text-xs text-slate-400">
                  {idempotencyKey ?? 'Generated when you first apply; retained for safe retry.'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!canApply}
                className="min-h-11 rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applyBusy ? 'Applying transition…' : 'Apply reviewed transition'}
              </button>
              <span className="text-xs text-slate-400">
                Preview remains read-only until this protected request is accepted with a receipt.
              </span>
            </div>
          </form>
        </>
      )}

      {receipt !== null && (
        <section
          aria-live="polite"
          className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-5 text-sm text-emerald-50"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            Transition receipt {receipt.replayed ? '· replayed' : '· recorded'}
          </p>
          <h2 className="mt-1 font-heading text-xl text-white">
            {receipt.replayed
              ? 'Existing transition receipt returned'
              : 'Future staffing transition recorded'}
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-emerald-200/80">Effective date</dt>
              <dd className="mt-1 font-medium text-white">{receipt.effectiveOn}</dd>
            </div>
            <div>
              <dt className="text-emerald-200/80">Assignments</dt>
              <dd className="mt-1 font-medium text-white">
                {receipt.createdAssignments === null
                  ? 'Receipt replay; count not repeated'
                  : receipt.createdAssignments}
              </dd>
            </div>
            <div>
              <dt className="text-emerald-200/80">Lifecycle evidence</dt>
              <dd className="mt-1 font-medium text-white">
                {receipt.lifecycleEventIds.length} event ID(s)
              </dd>
            </div>
            <div>
              <dt className="text-emerald-200/80">Portal writeback</dt>
              <dd className="mt-1 font-medium text-white">
                {receipt.portalWriteback === 'not_enqueued'
                  ? 'Not enqueued'
                  : 'Not returned in receipt'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-emerald-100/85">
            {receipt.portalWriteback === 'not_enqueued'
              ? 'Portal writeback was not enqueued by this transition.'
              : 'Do not infer portal status from this response; obtain the required audit evidence.'}
          </p>
          {receipt.lifecycleEventIds.length > 0 && (
            <details className="mt-4 rounded border border-emerald-800/70 bg-emerald-950/20 p-3">
              <summary className="cursor-pointer font-medium text-emerald-50">
                Lifecycle event evidence
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-emerald-100/90">
                {receipt.lifecycleEventIds.map((id, index) => (
                  <li key={id}>Recorded lifecycle event {index + 1}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </section>
  );
}
