'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';

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
  const refreshProjections = usePersonnelProjectionRefresh();
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
      await refreshProjections();
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
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Effective-dated staffing control
        </p>
        <h1 id="award-transition-heading" className="mt-1 font-heading text-3xl text-foreground">
          Award transition
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Convert one completed, immutable Bid into future staffing assignments only after reviewing
          the canonical current-to-new plan. This screen does not create awards or alter Bid policy.
        </p>
      </header>

      <section className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning">
        <h2 className="font-semibold text-warning">Fail-closed transition boundary</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-warning">
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
          className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning"
        >
          <h2 className="font-semibold">Select a completed Bid from its session controls</h2>
          <p className="mt-1 max-w-3xl text-warning">
            This protected workflow uses the session you selected from its operator controls. It
            will not accept a copied internal session identifier.
          </p>
          {selectionError !== null && <p className="mt-3 text-warning">{selectionError}</p>}
        </section>
      ) : (
        <form
          data-testid="award-transition-preview-form"
          onSubmit={previewTransition}
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-64 flex-1">
              <p className="text-sm font-medium text-foreground">Selected completed Bid</p>
              <p className="mt-1 text-sm text-info">{operatorContext.sessionLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Return to the session controls to select a different completed Bid.
              </p>
            </div>
            <Label className="block">
              <span className="text-sm font-medium text-foreground">Future effective date</span>
              <Input
                required
                type="date"
                value={effectiveOn}
                onChange={(event) => {
                  setEffectiveOn(event.target.value);
                  invalidatePreview();
                }}
                className="mt-1 block min-h-11 rounded border border-border bg-card px-3 py-2 text-foreground"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Validated again by the Worker in UTC.
              </span>
            </Label>
            <Button
              type="submit"
              disabled={!canPreview || previewBusy || applyBusy}
              className="min-h-11 rounded border border-info/40 bg-info-surface px-4 py-2 text-sm font-semibold text-info hover:border-info/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewBusy ? 'Loading preview…' : 'Preview transition'}
            </Button>
          </div>
        </form>
      )}

      {error !== null && (
        <output
          aria-live="polite"
          className="block rounded-lg border border-destructive/40 bg-destructive-surface p-4 text-sm text-destructive"
        >
          {error}
        </output>
      )}

      {operatorContext !== null && preview !== null && previewMatchesInput && (
        <>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Read-only canonical plan
                </p>
                <h2 className="mt-1 font-heading text-xl text-foreground">
                  Current-to-new assignments
                </h2>
                <p className="mt-1 text-sm text-foreground">
                  As of {preview.asOfDate}; proposed staffing takes effect on {preview.effectiveOn}.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-info/40 bg-info-surface px-3 py-1 text-xs font-semibold text-info">
                  {preview.plannedAssignments.length} planned
                </span>
                <span className="rounded-full border border-warning/40 bg-warning-surface px-3 py-1 text-xs font-semibold text-warning">
                  {preview.assignmentClosures.length} current assignment
                  {preview.assignmentClosures.length === 1 ? '' : 's'} close the prior day
                </span>
                {transitionCsvHref !== null && (
                  <a
                    data-testid="award-transition-csv"
                    href={transitionCsvHref}
                    className="inline-flex min-h-9 items-center rounded border border-border px-3 text-xs font-semibold text-foreground hover:border-border hover:text-foreground"
                  >
                    Download transition CSV
                  </a>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[72rem] text-left text-sm">
                <TableHeader className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <TableRow>
                    <TableHead className="px-5 py-3">Award</TableHead>
                    <TableHead className="px-4 py-3">Member</TableHead>
                    <TableHead className="px-4 py-3">Bid position</TableHead>
                    <TableHead className="px-4 py-3">Current staffing</TableHead>
                    <TableHead className="px-4 py-3">New staffing</TableHead>
                    <TableHead className="px-5 py-3">Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-800">
                  {preview.currentToNew.map((row) => (
                    <TableRow key={row.awardId} className="align-top text-foreground">
                      <TableCell className="px-5 py-3">
                        <p className="font-medium text-foreground">Award {row.ordinal}</p>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-foreground">
                        {memberLabel(operatorContext, row.memberId)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-foreground">
                        {bidPositionLabel(operatorContext, row.positionId)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-foreground">
                        {assignmentLabel(operatorContext, row.currentAssignment)}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <p className="font-medium text-info">
                          {staffingPositionLabel(
                            operatorContext,
                            row.newAssignment.staffingPositionId,
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          planned from {row.newAssignment.effectiveFrom}
                        </p>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-xs text-muted-foreground">
                        Immutable completed-Bid award evidence
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <form
            data-testid="award-transition-apply-form"
            onSubmit={applyTransition}
            className="rounded-xl border border-destructive/40 bg-destructive-surface p-5"
            aria-describedby="award-transition-apply-help"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
                  Protected action
                </p>
                <h2 className="mt-1 font-heading text-xl text-foreground">
                  Apply reviewed transition
                </h2>
                <p
                  id="award-transition-apply-help"
                  className="mt-1 max-w-3xl text-sm text-foreground"
                >
                  The Worker revalidates this plan immediately before its atomic effective-dated
                  write. Step-up confirmation may be requested before the application proceeds.
                </p>
              </div>
              <p className="max-w-sm border-l-2 border-warning/40 pl-3 text-xs leading-5 text-warning">
                A receipt must explicitly state that portal writeback is not enqueued. Missing
                receipt evidence remains an operator follow-up, not a completion claim.
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <Label className="block lg:col-span-2">
                <span className="text-sm font-medium text-foreground">Operator reason</span>
                <Textarea
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
                  className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  4–500 characters; retained with transition audit evidence.
                </span>
              </Label>
              <Label className="flex min-h-11 items-start gap-3 rounded border border-border bg-card p-3 text-sm text-foreground">
                <Input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border bg-card text-destructive focus:ring-ring"
                />
                <span>
                  I confirm this reviewed preview should create future staffing assignments and
                  close only the shown prior assignments on the preceding day.
                </span>
              </Label>
              <div className="rounded border border-border bg-card p-3 text-sm text-foreground">
                <p className="font-medium text-foreground">Idempotency key</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {idempotencyKey ?? 'Generated when you first apply; retained for safe retry.'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={!canApply}
                className="min-h-11 rounded bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applyBusy ? 'Applying transition…' : 'Apply reviewed transition'}
              </Button>
              <span className="text-xs text-muted-foreground">
                Preview remains read-only until this protected request is accepted with a receipt.
              </span>
            </div>
          </form>
        </>
      )}

      {receipt !== null && (
        <section
          aria-live="polite"
          className="rounded-xl border border-success/40 bg-success-surface p-5 text-sm text-success"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-success">
            Transition receipt {receipt.replayed ? '· replayed' : '· recorded'}
          </p>
          <h2 className="mt-1 font-heading text-xl text-foreground">
            {receipt.replayed
              ? 'Existing transition receipt returned'
              : 'Future staffing transition recorded'}
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-success">Effective date</dt>
              <dd className="mt-1 font-medium text-foreground">{receipt.effectiveOn}</dd>
            </div>
            <div>
              <dt className="text-success">Assignments</dt>
              <dd className="mt-1 font-medium text-foreground">
                {receipt.createdAssignments === null
                  ? 'Receipt replay; count not repeated'
                  : receipt.createdAssignments}
              </dd>
            </div>
            <div>
              <dt className="text-success">Lifecycle evidence</dt>
              <dd className="mt-1 font-medium text-foreground">
                {receipt.lifecycleEventIds.length} event ID(s)
              </dd>
            </div>
            <div>
              <dt className="text-success">Portal writeback</dt>
              <dd className="mt-1 font-medium text-foreground">
                {receipt.portalWriteback === 'not_enqueued'
                  ? 'Not enqueued'
                  : 'Not returned in receipt'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-success">
            {receipt.portalWriteback === 'not_enqueued'
              ? 'Portal writeback was not enqueued by this transition.'
              : 'Do not infer portal status from this response; obtain the required audit evidence.'}
          </p>
          {receipt.lifecycleEventIds.length > 0 && (
            <details className="mt-4 rounded border border-success/40 bg-success-surface p-3">
              <summary className="cursor-pointer font-medium text-success">
                Lifecycle event evidence
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-success">
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
