'use client';

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
  if (status === 'active') return 'border-emerald-700 bg-emerald-950/40 text-emerald-200';
  if (status === 'unknown') return 'border-amber-700 bg-amber-950/40 text-amber-100';
  if (status === 'retired' || status === 'separated') {
    return 'border-slate-600 bg-slate-900/70 text-slate-300';
  }
  return 'border-sky-800 bg-sky-950/30 text-sky-200';
}

function kindLabel(kind: string): string {
  return kind
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function randomIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `personnel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PersonnelWorkspace({
  summary,
  members,
  memberIdHint,
  assignmentIdHint,
}: PersonnelWorkspaceProps) {
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

      if (pendingChange === null && canPreview) {
        const previewResponse = await fetch('/api/admin/personnel/changes/preview', {
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
      const response = await fetch('/api/admin/personnel/changes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomIdempotencyKey(),
        },
        credentials: 'include',
        body: JSON.stringify(pendingChange ?? payload),
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
          : 'The reviewed lifecycle change was recorded. Refresh the workspace to view the new projection.',
      );
      setReason('');
      setPendingChange(null);
      setPreviewMessage(null);
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

      <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
              Year-round control
            </p>
            <h2 className="mt-1 font-heading text-xl text-white">Personnel lifecycle</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Record reviewed changes with an effective date, operator reason, and immutable
              receipt. No historical member or assignment is deleted.
            </p>
            <p className="mt-2 max-w-3xl text-xs text-slate-400">
              Civilian / no fire rank is supported as excluded personnel. Bid seniority is not
              required for excluded personnel; the effective date records this roster action and is
              not treated as a hire date.
            </p>
            {validMemberIdHint !== undefined && (
              <p className="mt-2 text-xs text-sky-200" data-testid="personnel-link-context">
                Linked member #{validMemberIdHint}
                {assignmentIdHint === undefined ? '' : ` · Linked assignment ${assignmentIdHint}`}
                {' · '}history opens automatically below.
              </p>
            )}
          </div>
          <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200">
            As of {summary.asOf}
          </span>
        </div>

        <form
          onSubmit={submitChange}
          data-testid="personnel-change-form"
          className="mt-5 grid gap-4 border-t border-slate-700 pt-5 lg:grid-cols-2"
        >
          <label className="block">
            <span className="text-sm text-slate-200">Change type</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
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
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-slate-200">Effective date</span>
            <input
              type="date"
              required
              value={effectiveOn}
              onChange={(event) => setEffectiveOn(event.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
            />
          </label>

          {!isNewHire && !isPositionChange && (
            <label className="block lg:col-span-2">
              <span className="text-sm text-slate-200">Member</span>
              <select
                required
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
              >
                <option value="">Select a member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.lastName}, {member.firstName} —{' '}
                    {member.rank ?? 'Civilian / no fire rank'} (
                    {statusLabel(member.employmentStatus)})
                  </option>
                ))}
              </select>
              {selectedMember?.employmentStatus === 'unknown' && (
                <span className="mt-1 block text-xs text-amber-200">
                  This legacy member is unclassified. The server will fail closed until an explicit
                  Correction establishes its reviewed employment state; transfer, promotion, and
                  separation changes remain unavailable until then.
                </span>
              )}
            </label>
          )}

          {isNewHire && (
            <>
              <label className="block">
                <span className="text-sm text-slate-200">Synthetic employee ID</span>
                <input
                  required
                  value={newEmployeeId}
                  onChange={(event) => setNewEmployeeId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-200">RSC seniority</span>
                <input
                  required={newBidCategory !== 'EXCLUDED'}
                  type="number"
                  min={0}
                  value={newRscSeniority}
                  onChange={(event) => setNewRscSeniority(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-200">First name</span>
                <input
                  required
                  value={newFirstName}
                  onChange={(event) => setNewFirstName(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-200">Last name</span>
                <input
                  required
                  value={newLastName}
                  onChange={(event) => setNewLastName(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-200">Bid category</span>
                <select
                  value={newBidCategory}
                  onChange={(event) => setNewBidCategory(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                >
                  <option value="FF">Firefighter</option>
                  <option value="OFC">Officer</option>
                  <option value="EXCLUDED">Excluded</option>
                </select>
              </label>
            </>
          )}

          {isPositionChange && (
            <>
              <label className="block">
                <span className="text-sm text-slate-200">Staffing position ID</span>
                <input
                  required
                  value={staffingPositionId}
                  onChange={(event) => setStaffingPositionId(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
              {kind === 'POSITION_CREATE' && (
                <>
                  <label className="block">
                    <span className="text-sm text-slate-200">Stable slot key</span>
                    <input
                      required
                      value={stableSlotKey}
                      onChange={(event) => setStableSlotKey(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                    />
                  </label>
                  <label className="block lg:col-span-2">
                    <span className="text-sm text-slate-200">Position name</span>
                    <input
                      value={positionName}
                      onChange={(event) => setPositionName(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
                    />
                  </label>
                </>
              )}
            </>
          )}

          {!isPositionChange && !requiresSlot && (
            <label className="block">
              <span className="text-sm text-slate-200">
                Destination staffing position ID (optional)
              </span>
              <input
                value={staffingPositionId}
                onChange={(event) => setStaffingPositionId(event.target.value)}
                placeholder="Reviewed canonical slot ID"
                className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white placeholder:text-slate-500"
              />
            </label>
          )}

          {!isPositionChange && requiresSlot && (
            <label className="block">
              <span className="text-sm text-slate-200">Staffing position ID</span>
              <input
                required
                value={staffingPositionId}
                onChange={(event) => setStaffingPositionId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
              />
            </label>
          )}

          {(isNewHire || isRankChange) && (
            <label className="block">
              <span className="text-sm text-slate-200">Rank after change</span>
              <select
                value={rankAfter}
                onChange={(event) => {
                  const nextRank = event.target.value;
                  setRankAfter(nextRank);
                  if (nextRank === 'CIVILIAN') {
                    setNewBidCategory('EXCLUDED');
                    setNewRscSeniority('');
                  }
                }}
                className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
              >
                {RANKS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
                {isNewHire && <option value="CIVILIAN">Civilian / no fire rank</option>}
              </select>
            </label>
          )}

          {isCorrection && (
            <label className="block">
              <span className="text-sm text-slate-200">Corrected employment state</span>
              <select
                value={correctionStatus}
                onChange={(event) => setCorrectionStatus(event.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="retired">Retired</option>
                <option value="separated">Separated</option>
              </select>
              <span className="mt-1 block text-xs text-slate-400">
                Use this reviewed correction path to classify legacy / unknown members before
                operational changes.
              </span>
            </label>
          )}

          {requiresSeparationType && (
            <label className="block">
              <span className="text-sm text-slate-200">Separation type</span>
              <input
                required
                value={separationType}
                onChange={(event) => setSeparationType(event.target.value)}
                placeholder="e.g., RETIREMENT"
                className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white placeholder:text-slate-500"
              />
            </label>
          )}

          <label className="block lg:col-span-2">
            <span className="text-sm text-slate-200">Operator reason</span>
            <textarea
              required
              minLength={4}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white"
              placeholder="Explain the reviewed personnel or staffing change."
            />
          </label>

          <div className="lg:col-span-2">
            {error !== null && (
              <output aria-live="polite" className="block text-sm text-red-300">
                {error}
              </output>
            )}
            {success !== null && (
              <output aria-live="polite" className="block text-sm text-emerald-300">
                {success}
              </output>
            )}
            {previewMessage !== null && (
              <output aria-live="polite" className="block text-sm text-sky-200">
                {previewMessage}
              </output>
            )}
            <button
              type="submit"
              disabled={busy || reason.trim().length < 4}
              className="mt-2 min-h-11 rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? pendingChange === null && canPreview
                  ? 'Previewing change…'
                  : 'Recording change…'
                : pendingChange === null && canPreview
                  ? 'Preview before recording'
                  : 'Confirm and record change'}
            </button>
          </div>
        </form>
      </section>

      <TemporaryOverlayWorkspace members={members} asOf={summary.asOf} />

      <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/40">
        <div className="border-b border-slate-700 px-5 py-4">
          <h2 className="font-heading text-lg text-white">Member projection and history</h2>
          <p className="mt-1 text-sm text-slate-300">
            Select a synthetic member to inspect lifecycle and assignment evidence.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Member</th>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Employment</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-5 py-3">History</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-5 py-3 text-white">
                    <span className="font-medium">
                      {member.firstName} {member.lastName}
                    </span>
                    <span className="ml-2 font-mono text-xs text-slate-500">
                      {member.employeeId}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-200">
                    {member.rank ?? 'Civilian / no fire rank'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(member.employmentStatus)}`}
                    >
                      {statusLabel(member.employmentStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {member.employmentStatusEffectiveOn ?? 'Not established'}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => loadHistory(member.id)}
                      className="min-h-10 rounded border border-slate-600 px-3 text-xs font-semibold text-slate-100 hover:border-red-500 hover:text-white"
                    >
                      View history
                    </button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    No member projections are available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {history !== null && historyMemberId !== null && (
          <div className="grid gap-5 border-t border-slate-700 p-5 lg:grid-cols-2">
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
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(pending === null ? {} : { 'Idempotency-Key': randomIdempotencyKey() }),
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
    setPending(null);
    setMessage(
      'Temporary overlay recorded. It can be ended explicitly below; no annual Bid vacancy was created.',
    );
    await load();
  }

  async function endOverlay(id: string) {
    const response = await fetch(`/api/admin/personnel/temporary-overlays/${id}/end`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomIdempotencyKey() },
      body: JSON.stringify({
        actual_end_on: asOf,
        reason: 'Command Staff ended the temporary overlay.',
      }),
    });
    if (!response.ok) {
      setError(`Overlay end failed (${response.status}).`);
      return;
    }
    setMessage(
      'Overlay ended. The operational view returns to the underlying assignment; annual Bid assignment is unchanged.',
    );
    await load();
  }

  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-5"
      aria-labelledby="temporary-overlays-heading"
    >
      <h2 id="temporary-overlays-heading" className="font-heading text-xl text-white">
        Temporary operational overlays
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        Special Assignment and Light Duty affect daily staffing only. Destination staffing remains
        policy pending; this does not create an annual Bid vacancy.
      </p>
      <form
        onSubmit={submit}
        data-testid="temporary-overlay-form"
        className="mt-5 grid gap-3 lg:grid-cols-2"
      >
        <label className="block">
          <span className="text-sm text-slate-200">Overlay type</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          >
            <option value="SPECIAL_ASSIGNMENT">Special Assignment</option>
            <option value="LIGHT_DUTY">Light Duty</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Member</span>
          <select
            required
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.lastName}, {member.firstName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Underlying assignment ID</span>
          <input
            required
            value={underlyingAssignmentId}
            onChange={(event) => {
              setUnderlyingAssignmentId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Underlying position ID</span>
          <input
            required
            value={underlyingPositionId}
            onChange={(event) => {
              setUnderlyingPositionId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Temporary operational position ID</span>
          <input
            required
            value={temporaryPositionId}
            onChange={(event) => {
              setTemporaryPositionId(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Effective date</span>
          <input
            required
            type="date"
            value={effectiveOn}
            onChange={(event) => {
              setEffectiveOn(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Planned end (optional)</span>
          <input
            type="date"
            value={plannedEndOn}
            onChange={(event) => {
              setPlannedEndOn(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-200">Source / provenance</span>
          <input
            required
            value={provenance}
            onChange={(event) => {
              setProvenance(event.target.value);
              setPending(null);
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>
        <div className="lg:col-span-2">
          {error !== null && (
            <output aria-live="polite" className="block text-sm text-red-300">
              {error}
            </output>
          )}
          {message !== null && (
            <output aria-live="polite" className="block text-sm text-sky-200">
              {message}
            </output>
          )}
          <button
            type="submit"
            className="mt-2 min-h-11 rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
          >
            {pending === null ? 'Preview overlay' : 'Confirm and record overlay'}
          </button>
        </div>
      </form>
      <div className="mt-5 border-t border-slate-700 pt-4">
        <h3 className="font-semibold text-white">Recorded overlays</h3>
        {overlays.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No temporary overlays are recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {overlays.map((overlay) => (
              <li
                key={overlay.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700 p-3 text-sm text-slate-200"
              >
                <span>
                  {overlay.kind} · member #{overlay.member_id} · {overlay.effective_on} ·{' '}
                  {overlay.status}
                </span>
                {overlay.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => void endOverlay(overlay.id)}
                    className="min-h-10 rounded border border-amber-700 px-3 text-xs font-semibold text-amber-100"
                  >
                    End overlay
                  </button>
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
      ? 'border-amber-800 bg-amber-950/30'
      : tone === 'sky'
        ? 'border-sky-900 bg-sky-950/30'
        : 'border-slate-700 bg-slate-800/50';
  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 font-heading text-2xl text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-300">{detail}</p>
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
      <h3 className="font-semibold text-white">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      ) : (
        <ol className="mt-2 space-y-2 text-sm text-slate-300">
          {items.map((item) => (
            <li
              key={item}
              className={`rounded border px-3 py-2 ${item === highlightedItem ? 'border-sky-500 bg-sky-950/40 text-sky-100' : 'border-slate-700 bg-slate-950/40'}`}
            >
              {item === highlightedItem && (
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-sky-300">
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
