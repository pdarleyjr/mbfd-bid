'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePersonnelProjectionRefresh } from '@/lib/admin-projection-refresh';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useRetainedMutation } from '@/lib/use-retained-mutation';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

export interface PersonnelSummary {
  asOf: string;
  members: {
    active: number;
    inactive: number;
    retired: number;
    separated: number;
    unclassified: number;
  };
  activeAssignments: number;
  upcomingChanges: number;
}

export interface PersonnelMember {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: string | null;
  employmentStatus: 'unknown' | 'active' | 'inactive' | 'retired' | 'separated';
  employmentStatusEffectiveOn: string | null;
  separationType: string | null;
}

interface LifecycleHistory {
  lifecycleEvents: Array<{
    id: string;
    kind: string;
    effectiveOn: string;
    reason: string;
    employmentStatusAfter: string | null;
    rankAfter: string | null;
  }>;
  assignments: Array<{
    id: string;
    staffingPositionId: string;
    status: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}

interface PersonnelWorkspaceProps {
  summary: PersonnelSummary;
  members: PersonnelMember[];
  memberIdHint?: number;
  assignmentIdHint?: string;
}

const RANKS = ['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] as const;
const MEMBER_KINDS = [
  'NEW_HIRE',
  'REACTIVATION',
  'PROMOTION',
  'DEMOTION',
  'TRANSFER',
  'ADMIN_REASSIGNMENT',
  'RETIREMENT',
  'SEPARATION',
  'VACATE',
  'CORRECTION',
] as const;
const POSITION_KINDS = ['POSITION_CREATE', 'POSITION_RETIRE'] as const;

function statusLabel(status: PersonnelMember['employmentStatus']): string {
  if (status === 'unknown') return 'Needs classification';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: PersonnelMember['employmentStatus']): string {
  if (status === 'active') return 'border-success/40 bg-success-surface text-success';
  if (status === 'unknown') return 'border-warning/40 bg-warning-surface text-warning';
  if (status === 'retired' || status === 'separated') {
    return 'border-border bg-card text-foreground';
  }
  return 'border-info/40 bg-info-surface text-info';
}

function kindLabel(kind: string): string {
  return kind
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export function PersonnelWorkspace({
  summary,
  members,
  memberIdHint,
  assignmentIdHint,
}: PersonnelWorkspaceProps) {
  const refreshProjections = usePersonnelProjectionRefresh();
  const mutation = useRetainedMutation<Record<string, unknown>>('personnel');
  const validMemberIdHint =
    memberIdHint !== undefined && members.some((member) => member.id === memberIdHint)
      ? memberIdHint
      : undefined;
  const [kind, setKind] = useState<(typeof MEMBER_KINDS)[number] | (typeof POSITION_KINDS)[number]>(
    'TRANSFER',
  );
  const [memberId, setMemberId] = useState(() => String(validMemberIdHint ?? members[0]?.id ?? ''));
  const [effectiveOn, setEffectiveOn] = useState(summary.asOf);
  const [reason, setReason] = useState('');
  const [staffingPositionId, setStaffingPositionId] = useState('');
  const [rankAfter, setRankAfter] = useState('FF');
  const [correctionStatus, setCorrectionStatus] = useState('active');
  const [separationType, setSeparationType] = useState('');
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newBidCategory, setNewBidCategory] = useState('FF');
  const [newRscSeniority, setNewRscSeniority] = useState('');
  const [stableSlotKey, setStableSlotKey] = useState('');
  const [positionName, setPositionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<LifecycleHistory | null>(null);
  const [historyMemberId, setHistoryMemberId] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<Record<string, unknown> | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === Number(memberId)) ?? null,
    [memberId, members],
  );
  const isNewHire = kind === 'NEW_HIRE';
  const isPositionChange = (POSITION_KINDS as readonly string[]).includes(kind);
  const isRankChange = kind === 'PROMOTION' || kind === 'DEMOTION' || kind === 'CORRECTION';
  const requiresSeparationType = kind === 'RETIREMENT' || kind === 'SEPARATION';
  const requiresSlot = kind === 'VACATE' || kind === 'POSITION_RETIRE';
  const isCorrection = kind === 'CORRECTION';
  const canPreview = !isNewHire && !isPositionChange;

  const loadHistory = useCallback(async (id: number) => {
    setError(null);
    setHistoryMemberId(id);
    try {
      const response = await fetch(`/api/admin/personnel/members/${id}/history`, {
        credentials: 'include',
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || body === null || typeof body !== 'object') {
        setError(`History could not be loaded (${response.status}).`);
        return;
      }
      setHistory(body as LifecycleHistory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'History could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (validMemberIdHint === undefined) return;
    setMemberId(String(validMemberIdHint));
    void loadHistory(validMemberIdHint);
  }, [loadHistory, validMemberIdHint]);

  async function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, unknown> = {
        kind,
        effective_on: effectiveOn,
        reason: reason.trim(),
      };
      if (isPositionChange) {
        if (kind === 'POSITION_CREATE') {
          payload.staffing_position = {
            id: staffingPositionId.trim(),
            stable_slot_key: stableSlotKey.trim(),
            position_name: positionName.trim() || null,
          };
        } else {
          payload.staffing_position_id = staffingPositionId.trim();
        }
      } else if (isNewHire) {
        const seniority = Number(newRscSeniority);
        payload.new_member = {
          employee_id: newEmployeeId.trim(),
          first_name: newFirstName.trim(),
          last_name: newLastName.trim(),
          rank: rankAfter === 'CIVILIAN' ? null : rankAfter,
          bid_category: newBidCategory,
          ...(newBidCategory === 'EXCLUDED' && newRscSeniority.trim() === ''
            ? {}
            : { rsc_seniority: Number.isFinite(seniority) ? seniority : -1 }),
        };
        if (rankAfter !== 'CIVILIAN') payload.rank_after = rankAfter;
        if (staffingPositionId.trim()) payload.staffing_position_id = staffingPositionId.trim();
      } else {
        payload.member_id = Number(memberId);
        if (staffingPositionId.trim()) payload.staffing_position_id = staffingPositionId.trim();
        if (isRankChange) payload.rank_after = rankAfter;
        if (isCorrection) payload.employment_status_after = correctionStatus;
        if (requiresSeparationType) payload.separation_type = separationType.trim();
      }

      if (canPreview && JSON.stringify(pendingChange) !== JSON.stringify(payload)) {
        const previewResponse = await csrfFetch('/api/admin/personnel/changes/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const previewBody: unknown = await previewResponse.json().catch(() => null);
        if (!previewResponse.ok) {
          const detail =
            previewBody !== null && typeof previewBody === 'object' && 'error' in previewBody
              ? String((previewBody as { error: unknown }).error)
              : `Preview failed (${previewResponse.status}).`;
          setError(detail);
          return;
        }
        setPendingChange(payload);
        setPreviewMessage(
          'Preview complete. Confirm to record this effective-dated change; the preview made no changes.',
        );
        return;
      }
      const request = mutation.prepare(JSON.stringify(payload), () => payload);
      const response = await csrfFetch('/api/admin/personnel/changes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': request.key,
        },
        credentials: 'include',
        body: JSON.stringify(request.payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body !== null && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : `Request failed (${response.status}).`;
        setError(detail);
        return;
      }
      setSuccess(
        response.status === 200
          ? 'The original lifecycle receipt was returned; no duplicate change was made.'
          : 'The reviewed lifecycle change was recorded. Updated projections are refreshing.',
      );
      mutation.accepted(request.key);
      setReason('');
      setPendingChange(null);
      setPreviewMessage(null);
      await refreshProjections();
      if (historyMemberId !== null) await loadHistory(historyMemberId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Personnel change could not be recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="Personnel health" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Active members"
          value={summary.members.active}
          detail={`${summary.activeAssignments} active assignments`}
        />
        <Metric
          label="Needs classification"
          value={summary.members.unclassified}
          detail="Legacy / unknown status is not treated as active"
          tone="amber"
        />
        <Metric
          label="Upcoming changes"
          value={summary.upcomingChanges}
          detail={`As of ${summary.asOf}`}
          tone="sky"
        />
        <Metric
          label="Separation history"
          value={summary.members.retired + summary.members.separated}
          detail={`${summary.members.inactive} inactive member(s)`}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
              Year-round control
            </p>
            <h2 className="mt-1 font-heading text-xl text-foreground">Personnel lifecycle</h2>
            <p className="mt-2 max-w-3xl text-sm text-foreground">
              Record reviewed changes with an effective date, operator reason, and immutable
              receipt. No historical member or assignment is deleted.
            </p>
            <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
              Civilian / no fire rank is supported as excluded personnel. Bid seniority is not
              required for excluded personnel; the effective date records this roster action and is
              not treated as a hire date.
            </p>
            {validMemberIdHint !== undefined && (
              <p className="mt-2 text-xs text-info" data-testid="personnel-link-context">
                Linked member #{validMemberIdHint}
                {assignmentIdHint === undefined ? '' : ` · Linked assignment ${assignmentIdHint}`}
                {' · '}history opens automatically below.
              </p>
            )}
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground">
            As of {summary.asOf}
          </span>
        </div>

        <form
          onSubmit={submitChange}
          onChange={() => {
            setPendingChange(null);
            setPreviewMessage(null);
          }}
          data-testid="personnel-change-form"
          className="mt-5 grid gap-4 border-t border-border pt-5 lg:grid-cols-2"
        >
          <Label className="block">
            <span className="text-sm text-foreground">Change type</span>
            <NativeSelect
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            >
              <optgroup label="Member changes">
                {MEMBER_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'NEW_HIRE' || option === 'REACTIVATION'
                      ? 'New hire / reactivation'
                      : kindLabel(option)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Staffing position changes">
                {POSITION_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {kindLabel(option)}
                  </option>
                ))}
              </optgroup>
            </NativeSelect>
          </Label>

          <Label className="block">
            <span className="text-sm text-foreground">Effective date</span>
            <Input
              type="date"
              required
              value={effectiveOn}
              onChange={(event) => setEffectiveOn(event.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
            />
          </Label>

          {!isNewHire && !isPositionChange && (
            <Label className="block lg:col-span-2">
              <span className="text-sm text-foreground">Member</span>
              <NativeSelect
                required
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
              >
                <option value="">Select a member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.lastName}, {member.firstName} —{' '}
                    {member.rank ?? 'Civilian / no fire rank'} (
                    {statusLabel(member.employmentStatus)})
                  </option>
                ))}
              </NativeSelect>
              {selectedMember?.employmentStatus === 'unknown' && (
                <span className="mt-1 block text-xs text-warning">
                  This legacy member is unclassified. The server will fail closed until an explicit
                  Correction establishes its reviewed employment state; transfer, promotion, and
                  separation changes remain unavailable until then.
                </span>
              )}
            </Label>
          )}

          {isNewHire && (
            <>
              <Label className="block">
                <span className="text-sm text-foreground">Synthetic employee ID</span>
                <Input
                  required
                  value={newEmployeeId}
                  onChange={(event) => setNewEmployeeId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                />
              </Label>
              <Label className="block">
                <span className="text-sm text-foreground">RSC seniority</span>
                <Input
                  required={newBidCategory !== 'EXCLUDED'}
                  type="number"
                  min={0}
                  value={newRscSeniority}
                  onChange={(event) => setNewRscSeniority(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                />
              </Label>
              <Label className="block">
                <span className="text-sm text-foreground">First name</span>
                <Input
                  required
                  value={newFirstName}
                  onChange={(event) => setNewFirstName(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                />
              </Label>
              <Label className="block">
                <span className="text-sm text-foreground">Last name</span>
                <Input
                  required
                  value={newLastName}
                  onChange={(event) => setNewLastName(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                />
              </Label>
              <Label className="block">
                <span className="text-sm text-foreground">Bid category</span>
                <NativeSelect
                  value={newBidCategory}
                  onChange={(event) => setNewBidCategory(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                >
                  <option value="FF">Firefighter</option>
                  <option value="OFC">Officer</option>
                  <option value="EXCLUDED">Excluded</option>
                </NativeSelect>
              </Label>
            </>
          )}

          {isPositionChange && (
            <>
              <Label className="block">
                <span className="text-sm text-foreground">Staffing position ID</span>
                <Input
                  required
                  value={staffingPositionId}
                  onChange={(event) => setStaffingPositionId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                />
              </Label>
              {kind === 'POSITION_CREATE' && (
                <>
                  <Label className="block">
                    <span className="text-sm text-foreground">Stable slot key</span>
                    <Input
                      required
                      value={stableSlotKey}
                      onChange={(event) => setStableSlotKey(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                    />
                  </Label>
                  <Label className="block lg:col-span-2">
                    <span className="text-sm text-foreground">Position name</span>
                    <Input
                      value={positionName}
                      onChange={(event) => setPositionName(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
                    />
                  </Label>
                </>
              )}
            </>
          )}

          {!isPositionChange && !requiresSlot && (
            <Label className="block">
              <span className="text-sm text-foreground">
                Destination staffing position ID (optional)
              </span>
              <Input
                value={staffingPositionId}
                onChange={(event) => setStaffingPositionId(event.target.value)}
                placeholder="Reviewed canonical slot ID"
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground"
              />
            </Label>
          )}

          {!isPositionChange && requiresSlot && (
            <Label className="block">
              <span className="text-sm text-foreground">Staffing position ID</span>
              <Input
                required
                value={staffingPositionId}
                onChange={(event) => setStaffingPositionId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
              />
            </Label>
          )}

          {(isNewHire || isRankChange) && (
            <Label className="block">
              <span className="text-sm text-foreground">Rank after change</span>
              <NativeSelect
                value={rankAfter}
                onChange={(event) => {
                  const nextRank = event.target.value;
                  setRankAfter(nextRank);
                  if (nextRank === 'CIVILIAN') {
                    setNewBidCategory('EXCLUDED');
                    setNewRscSeniority('');
                  }
                }}
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
              >
                {RANKS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
                {isNewHire && <option value="CIVILIAN">Civilian / no fire rank</option>}
              </NativeSelect>
            </Label>
          )}

          {isCorrection && (
            <Label className="block">
              <span className="text-sm text-foreground">Corrected employment state</span>
              <NativeSelect
                value={correctionStatus}
                onChange={(event) => setCorrectionStatus(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="retired">Retired</option>
                <option value="separated">Separated</option>
              </NativeSelect>
              <span className="mt-1 block text-xs text-muted-foreground">
                Use this reviewed correction path to classify legacy / unknown members before
                operational changes.
              </span>
            </Label>
          )}

          {requiresSeparationType && (
            <Label className="block">
              <span className="text-sm text-foreground">Separation type</span>
              <Input
                required
                value={separationType}
                onChange={(event) => setSeparationType(event.target.value)}
                placeholder="e.g., RETIREMENT"
                className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground placeholder:text-muted-foreground"
              />
            </Label>
          )}

          <Label className="block lg:col-span-2">
            <span className="text-sm text-foreground">Operator reason</span>
            <Textarea
              required
              minLength={4}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-foreground"
              placeholder="Explain the reviewed personnel or staffing change."
            />
          </Label>

          <div className="lg:col-span-2">
            {error !== null && (
              <output aria-live="polite" className="block text-sm text-destructive">
                {error}
              </output>
            )}
            {success !== null && (
              <output aria-live="polite" className="block text-sm text-success">
                {success}
              </output>
            )}
            {previewMessage !== null && (
              <output aria-live="polite" className="block text-sm text-info">
                {previewMessage}
              </output>
            )}
            <Button
              type="submit"
              disabled={busy || reason.trim().length < 4}
              className="mt-2 min-h-11 rounded bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? pendingChange === null && canPreview
                  ? 'Previewing change…'
                  : 'Recording change…'
                : pendingChange === null && canPreview
                  ? 'Preview before recording'
                  : 'Confirm and record change'}
            </Button>
          </div>
        </form>
      </section>

      <TemporaryOverlayWorkspace members={members} asOf={summary.asOf} />

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-heading text-lg text-foreground">Member projection and history</h2>
          <p className="mt-1 text-sm text-foreground">
            Select a synthetic member to inspect lifecycle and assignment evidence.
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[700px] text-left text-sm">
            <TableHeader className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
              <TableRow>
                <TableHead className="px-5 py-3">Member</TableHead>
                <TableHead className="px-4 py-3">Rank</TableHead>
                <TableHead className="px-4 py-3">Employment</TableHead>
                <TableHead className="px-4 py-3">Effective</TableHead>
                <TableHead className="px-5 py-3">History</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-800">
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="px-5 py-3 text-foreground">
                    <span className="font-medium">
                      {member.firstName} {member.lastName}
                    </span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {member.employeeId}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 font-mono text-foreground">
                    {member.rank ?? 'Civilian / no fire rank'}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(member.employmentStatus)}`}
                    >
                      {statusLabel(member.employmentStatus)}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">
                    {member.employmentStatusEffectiveOn ?? 'Not established'}
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    <Button
                      type="button"
                      onClick={() => loadHistory(member.id)}
                      className="min-h-10 rounded border border-border px-3 text-xs font-semibold text-foreground hover:border-destructive/40 hover:text-foreground"
                    >
                      View history
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No member projections are available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {history !== null && historyMemberId !== null && (
          <div className="grid gap-5 border-t border-border p-5 lg:grid-cols-2">
            <HistoryList
              title="Lifecycle events"
              empty="No lifecycle events were returned."
              items={history.lifecycleEvents.map(
                (event) => `${event.effectiveOn} · ${kindLabel(event.kind)} · ${event.reason}`,
              )}
            />
            <HistoryList
              title="Assignment history"
              empty="No assignment history was returned."
              items={history.assignments.map(
                (assignment) =>
                  `${assignment.staffingPositionId} · ${assignment.status} · ${assignment.effectiveFrom}${assignment.effectiveTo ? ` → ${assignment.effectiveTo}` : ''}`,
              )}
              highlightedItem={
                assignmentIdHint === undefined
                  ? undefined
                  : history.assignments
                      .filter((assignment) => assignment.id === assignmentIdHint)
                      .map(
                        (assignment) =>
                          `${assignment.staffingPositionId} · ${assignment.status} · ${assignment.effectiveFrom}${assignment.effectiveTo ? ` → ${assignment.effectiveTo}` : ''}`,
                      )[0]
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function TemporaryOverlayWorkspace({
  members,
  asOf,
}: {
  members: PersonnelMember[];
  asOf: string;
}) {
  const refreshProjections = usePersonnelProjectionRefresh();
  const creation = useRetainedMutation<Record<string, unknown>>('temporary-overlay');
  const ending = useRetainedMutation<{ actual_end_on: string; reason: string }>('end-overlay');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'SPECIAL_ASSIGNMENT' | 'LIGHT_DUTY'>('SPECIAL_ASSIGNMENT');
  const [memberId, setMemberId] = useState(String(members[0]?.id ?? ''));
  const [underlyingAssignmentId, setUnderlyingAssignmentId] = useState('');
  const [underlyingPositionId, setUnderlyingPositionId] = useState('');
  const [temporaryPositionId, setTemporaryPositionId] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(asOf);
  const [plannedEndOn, setPlannedEndOn] = useState('');
  const [provenance, setProvenance] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<
    Array<{
      id: string;
      member_id: number;
      kind: string;
      effective_on: string;
      status: string;
      actual_end_on: string | null;
    }>
  >([]);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/personnel/temporary-overlays', {
      credentials: 'include',
    });
    if (!response.ok) return;
    const body = (await response.json()) as { overlays?: typeof overlays };
    setOverlays(body.overlays ?? []);
  }, []);
  useEffect(() => {
    void load().catch(() => setError('Recorded overlays could not be refreshed.'));
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      setError(null);
      setMessage(null);
      const payload = pending ?? {
        kind,
        member_id: Number(memberId),
        underlying_assignment_id: underlyingAssignmentId.trim(),
        underlying_position_id: underlyingPositionId.trim(),
        temporary_position_id: temporaryPositionId.trim(),
        effective_on: effectiveOn,
        planned_end_on: plannedEndOn || null,
        provenance: provenance.trim(),
      };
      const path =
        pending === null
          ? '/api/admin/personnel/temporary-overlays/preview'
          : '/api/admin/personnel/temporary-overlays';
      const request =
        pending === null ? null : creation.prepare(JSON.stringify(payload), () => payload);
      const response = await csrfFetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(request === null ? {} : { 'Idempotency-Key': request.key }),
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          body !== null && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : `Overlay request failed (${response.status}).`,
        );
        return;
      }
      if (pending === null) {
        setPending(payload);
        setMessage(
          'Preview confirms a daily-staffing-only impact. The underlying permanent and annual Bid assignments stay unchanged; confirm to record.',
        );
        return;
      }
      if (request) creation.accepted(request.key);
      setPending(null);
      setMessage(
        'Temporary overlay recorded. It can be ended explicitly below; no annual Bid vacancy was created.',
      );
      await load();
      await refreshProjections();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Overlay request could not be confirmed. Retry the same request.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function endOverlay(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const payload = { actual_end_on: asOf, reason: 'Command Staff ended the temporary overlay.' };
      const request = ending.prepare(JSON.stringify({ id, ...payload }), () => payload);
      const response = await csrfFetch(`/api/admin/personnel/temporary-overlays/${id}/end`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key },
        body: JSON.stringify(request.payload),
      });
      if (!response.ok) {
        setError(`Overlay end failed (${response.status}).`);
        return;
      }
      ending.accepted(request.key);
      setMessage(
        'Overlay ended. The operational view returns to the underlying assignment; annual Bid assignment is unchanged.',
      );
      await load();
      await refreshProjections();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Overlay end could not be confirmed. Retry the same request.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-border bg-card p-5"
      aria-labelledby="temporary-overlays-heading"
    >
      <h2 id="temporary-overlays-heading" className="font-heading text-xl text-foreground">
        Temporary operational overlays
      </h2>
      <p className="mt-2 text-sm text-foreground">
        Special Assignment and Light Duty affect daily staffing only. Destination staffing remains
        policy pending; this does not create an annual Bid vacancy.
      </p>
      <form
        onSubmit={submit}
        data-testid="temporary-overlay-form"
        className="mt-5 grid gap-3 lg:grid-cols-2"
      >
        <Label className="block">
          <span className="text-sm text-foreground">Overlay type</span>
          <NativeSelect
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          >
            <option value="SPECIAL_ASSIGNMENT">Special Assignment</option>
            <option value="LIGHT_DUTY">Light Duty</option>
          </NativeSelect>
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Member</span>
          <NativeSelect
            required
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.lastName}, {member.firstName}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Underlying assignment ID</span>
          <Input
            required
            value={underlyingAssignmentId}
            onChange={(event) => {
              setUnderlyingAssignmentId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Underlying position ID</span>
          <Input
            required
            value={underlyingPositionId}
            onChange={(event) => {
              setUnderlyingPositionId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Temporary operational position ID</span>
          <Input
            required
            value={temporaryPositionId}
            onChange={(event) => {
              setTemporaryPositionId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Effective date</span>
          <Input
            required
            type="date"
            value={effectiveOn}
            onChange={(event) => {
              setEffectiveOn(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Planned end (optional)</span>
          <Input
            type="date"
            value={plannedEndOn}
            onChange={(event) => {
              setPlannedEndOn(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Source / provenance</span>
          <Input
            required
            value={provenance}
            onChange={(event) => {
              setProvenance(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-foreground"
          />
        </Label>
        <div className="lg:col-span-2">
          {error !== null && (
            <output aria-live="polite" className="block text-sm text-destructive">
              {error}
            </output>
          )}
          {message !== null && (
            <output aria-live="polite" className="block text-sm text-info">
              {message}
            </output>
          )}
          <Button
            type="submit"
            disabled={busy}
            className="mt-2 min-h-11 rounded bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-destructive"
          >
            {pending === null ? 'Preview overlay' : 'Confirm and record overlay'}
          </Button>
        </div>
      </form>
      <div className="mt-5 border-t border-border pt-4">
        <h3 className="font-semibold text-foreground">Recorded overlays</h3>
        {overlays.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No temporary overlays are recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {overlays.map((overlay) => (
              <li
                key={overlay.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3 text-sm text-foreground"
              >
                <span>
                  {overlay.kind} · member #{overlay.member_id} · {overlay.effective_on} ·{' '}
                  {overlay.status}
                </span>
                {overlay.status === 'active' && (
                  <Button
                    type="button"
                    onClick={() => void endOverlay(overlay.id)}
                    disabled={busy}
                    className="min-h-10 rounded border border-warning/40 px-3 text-xs font-semibold text-warning"
                  >
                    End overlay
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = 'slate',
}: { label: string; value: number; detail: string; tone?: 'slate' | 'amber' | 'sky' }) {
  const toneClasses =
    tone === 'amber'
      ? 'border-warning/40 bg-warning-surface'
      : tone === 'sky'
        ? 'border-info/40 bg-info-surface'
        : 'border-border bg-card';
  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-2xl text-foreground">{value}</p>
      <p className="mt-1 text-xs text-foreground">{detail}</p>
    </div>
  );
}

function HistoryList({
  title,
  empty,
  items,
  highlightedItem,
}: {
  title: string;
  empty: string;
  items: string[];
  highlightedItem?: string | undefined;
}) {
  return (
    <div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 space-y-2 text-sm text-foreground">
          {items.map((item) => (
            <li
              key={item}
              className={`rounded border px-3 py-2 ${item === highlightedItem ? 'border-info/40 bg-info-surface text-info' : 'border-border bg-card'}`}
            >
              {item === highlightedItem && (
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-info">
                  Linked assignment
                </span>
              )}
              {item}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
