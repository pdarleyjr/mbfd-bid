'use client';
import { invalidateWorkingBidBoards } from '@/lib/admin-projection-refresh';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { AnnualPlanFreeze } from './AnnualPlanFreeze';
import { AnnualPlanParticipants } from './AnnualPlanParticipants';
import { AnnualPlanProfiles } from './AnnualPlanProfiles';
import { AnnualPlanReview } from './AnnualPlanReview';
import { AnnualPlanSeats } from './AnnualPlanSeats';
import {
  type AnnualPlan,
  annualGet,
  annualPost,
  buttonClass,
  expectedPlan,
  fieldClass,
} from './annual-plan-client';

const stages = [
  'Start or resume',
  'Organization and seats',
  'Participants and evidence',
  'Requirements and priorities',
  'Operating policy',
  'Review and impact',
  'Rehearse and freeze',
];
export function AnnualPlanWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const value = Number(params.get('year'));
  const year =
    Number.isInteger(value) && value >= 2024 && value <= 2100
      ? value
      : new Date().getFullYear() + 1;
  const rawStage = Number(params.get('stage'));
  const stage = rawStage >= 1 && rawStage <= 7 && Number.isInteger(rawStage) ? rawStage : 1;
  const [dirty, setDirty] = useState(false);
  const plans = useQuery({
    queryKey: ['admin', 'annual-plan', 'list'],
    queryFn: () =>
      annualGet<{ plans: { year: number; ruleBookStatus: string; effectiveOn: string | null }[] }>(
        'annual-plan',
      ),
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: ['admin', 'annual-plan', year],
    queryFn: () =>
      annualGet<{
        plan: AnnualPlan;
        coverage: {
          valid: boolean;
          ruleCount: number;
          missingBiddablePositionIds: string[];
        } | null;
      }>(`annual-plan/${year}`),
    enabled: plans.data?.plans.some((p) => p.year === year) ?? false,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.plan.lifecycle === 'DRAFT' ? 60_000 : false),
    refetchIntervalInBackground: false,
  });
  const plan = detail.data?.plan;
  const hasSavedPlan = plans.data?.plans.some((p) => p.year === year) ?? false;
  const loadingPlan = plans.isPending || (hasSavedPlan && detail.isPending);
  const unavailablePlan = !plan && (plans.isError || (hasSavedPlan && detail.isError));
  const navigate = (targetYear: number, targetStage: number) => {
    if (dirty && !window.confirm('Discard unsaved preparation edits?')) return;
    setDirty(false);
    router.push(`/admin/annual-plan?year=${targetYear}&stage=${targetStage}` as Route);
  };
  const changed = async () => {
    setDirty(false);
    await client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] });
    await invalidateWorkingBidBoards(client, ['upcoming']);
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6 text-slate-100">
      <header>
        <p className="text-xs uppercase tracking-wider text-slate-400">MBFD annual preparation</p>
        <h1 className="mt-1 font-heading text-3xl">Prepare Next Bid</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Build and review the designated annual plan. Saved drafts resume here; rehearsal and
          freezing remain subject to the existing bid safeguards.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <label className="w-36">
          Bid year
          <input
            aria-label="Preparation year"
            type="number"
            min={2024}
            max={2100}
            key={year}
            defaultValue={year}
            className={fieldClass}
            onBlur={(e) => {
              const selected = Number(e.target.value);
              if (
                Number.isInteger(selected) &&
                selected >= 2024 &&
                selected <= 2100 &&
                selected !== year
              )
                navigate(selected, 1);
            }}
          />
        </label>
        <span className="rounded border border-slate-600 px-3 py-2">
          {year} ·{' '}
          {plan?.lifecycle ??
            (unavailablePlan
              ? 'Unavailable'
              : loadingPlan
                ? 'Checking saved plan…'
                : 'Not started')}
        </span>
        {plan && (
          <span className="text-sm text-slate-400">
            Rules revision {plan.ruleBookRevision} · Configuration revision{' '}
            {plan.configurationRevision}
          </span>
        )}
        <Link
          className={`${buttonClass} ml-auto`}
          href={`/admin/bid-board?view=upcoming&year=${year}&shift=A` as Route}
        >
          Upcoming Board
        </Link>
      </div>
      {(plans.isError || detail.isError) && (
        <p role="alert" className="rounded border border-amber-700 p-4 text-amber-200">
          {detail.error?.message ?? plans.error?.message}.{' '}
          {detail.data
            ? 'Showing the last successful response; saved changes still require revision checks.'
            : ''}
        </p>
      )}
      <nav
        aria-label="Annual preparation stages"
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7"
      >
        {stages.map((label, index) => (
          <button
            type="button"
            key={label}
            onClick={() => navigate(year, index + 1)}
            aria-current={stage === index + 1 ? 'step' : undefined}
            className={`min-h-16 rounded border px-3 py-2 text-left text-sm ${stage === index + 1 ? 'border-amber-500 bg-amber-950/30 text-amber-100' : 'border-slate-600 bg-slate-900'}`}
          >
            <span className="block text-xs text-slate-400">Stage {index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <section
        key={`${year}:${stage}`}
        className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 sm:p-6"
      >
        <h2 className="mb-4 font-heading text-xl">
          {stage}. {stages[stage - 1]}
        </h2>
        {unavailablePlan ? (
          <p>
            Saved preparation could not be verified. Restore the connection before starting or
            adopting a plan.
          </p>
        ) : loadingPlan ? (
          <output className="block">Loading saved preparation…</output>
        ) : stage === 1 ? (
          <StartPlan
            year={year}
            plan={plan}
            plans={plans.data?.plans ?? []}
            onDirty={setDirty}
            onSaved={changed}
            onResume={navigate}
          />
        ) : !plan ? (
          <p>Select an existing year or start a plan in stage 1.</p>
        ) : !plan.effectiveOn ? (
          <p>
            This year has not entered guided preparation. Return to stage 1 to review adoption of an
            unpublished draft, or{' '}
            <Link className="underline" href={`/admin/bid-setup?year=${year}` as Route}>
              Open its configuration
            </Link>{' '}
            to review the designated source.
          </p>
        ) : (
          <>
            {plan.lifecycle !== 'DRAFT' && (
              <p className="mb-4 text-amber-200">
                This plan is {plan.lifecycle.toLowerCase()}; preparation edits are unavailable.
              </p>
            )}
            {stage === 2 && <AnnualPlanSeats plan={plan} onDirty={setDirty} onSaved={changed} />}
            {stage === 3 && <AnnualPlanParticipants plan={plan} />}
            {stage === 4 && <AnnualPlanProfiles plan={plan} onDirty={setDirty} onSaved={changed} />}
            {stage === 5 && (
              <div className="space-y-4">
                <p className="text-slate-300">
                  Review stage order, specialty interruptions, A-Day allocation, contact and
                  preference rules, pause/resume behavior, timing, authority and amendment
                  permissions in the annual operating policy editor.
                </p>
                <Link
                  className={`${buttonClass} inline-block`}
                  href={`/admin/annual-policy?year=${year}` as Route}
                >
                  Edit {year} operating policy
                </Link>
                <p className="text-sm text-slate-400">
                  Return to this plan after saving. The review checks the exact designated document
                  and configuration revision.
                </p>
              </div>
            )}
            {stage === 6 && <AnnualPlanReview plan={plan} onDirty={setDirty} onSaved={changed} />}
            {stage === 7 && <AnnualPlanFreeze plan={plan} onDirty={setDirty} onSaved={changed} />}
          </>
        )}
      </section>
      <div className="flex justify-between">
        <button
          type="button"
          className={buttonClass}
          disabled={stage === 1}
          onClick={() => navigate(year, stage - 1)}
        >
          Previous stage
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={stage === 7}
          onClick={() => navigate(year, stage + 1)}
        >
          Next stage
        </button>
      </div>
    </div>
  );
}

function StartPlan({
  year,
  plan,
  plans,
  onDirty,
  onSaved,
  onResume,
}: {
  year: number;
  plan: AnnualPlan | undefined;
  plans: { year: number; ruleBookStatus: string }[];
  onDirty(value: boolean): void;
  onSaved(): Promise<void>;
  onResume(year: number, stage: number): void;
}) {
  const sources = useQuery({
    queryKey: ['admin', 'annual-plan', 'official-sources'],
    queryFn: () =>
      annualGet<{
        sources: { sessionId: string; year: number; completedAtMs: number }[];
        notice: string | null;
      }>('annual-plan/official-sources'),
    staleTime: 60_000,
  });
  const [effective, setEffective] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [timer, setTimer] = useState('');
  const [duration, setDuration] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReturnType<typeof expectedPlan> | null>(
    null,
  );
  const revision = useRef<ReturnType<typeof expectedPlan> | null>(null);
  const draftMode = useRef<boolean | null>(null);
  const adopting = draftMode.current ?? (!!plan && !plan.effectiveOn && plan.lifecycle === 'DRAFT');
  const dirty = !!(
    effective ||
    qualifications ||
    timer ||
    duration ||
    source ||
    reason ||
    accepted
  );
  useUnsavedChanges(dirty, 'annual start edits');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = {
      ...(adopting && revision.current
        ? { ...revision.current, accept_existing_draft: accepted }
        : { year }),
      effective_on: effective,
      credential_evaluation_on: qualifications,
      turn_timer_seconds: Number(timer),
      expected_duration_days: Number(duration),
      ...(!adopting && source ? { source_session_id: source } : {}),
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost(
        adopting ? `annual-plan/${year}/adopt` : 'annual-plan',
        body,
        pending.current.key,
      );
      setEffective('');
      setQualifications('');
      setTimer('');
      setDuration('');
      setSource('');
      setReason('');
      setAccepted(false);
      draftMode.current = null;
      revision.current = null;
      pending.current = null;
      setReconciliation(null);
      onDirty(false);
      await onSaved();
      setMessage('Annual draft saved. Continue to organization and seats.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {plans.length > 0 && (
        <label className="block max-w-sm">
          Resume a saved year
          <select
            className={fieldClass}
            value={plan ? year : ''}
            onChange={(e) => {
              if (e.target.value) onResume(Number(e.target.value), 2);
            }}
          >
            <option value="">Choose a year</option>
            {plans.map((p) => (
              <option key={p.year} value={p.year}>
                {p.year} · {p.ruleBookStatus ?? 'Unconfigured'}
              </option>
            ))}
          </select>
        </label>
      )}
      {plan && !adopting ? (
        <p>
          {plan.effectiveOn
            ? `The designated ${year} plan is saved. Continue to review its organization, participants and policy.`
            : `The designated ${year} configuration is ${plan.lifecycle.toLowerCase()}. Guided adoption requires an unpublished draft with no Real session.`}
        </p>
      ) : (
        <form
          onSubmit={save}
          onChange={() => {
            if (draftMode.current === null) draftMode.current = adopting;
            if (adopting && plan && !revision.current) revision.current = expectedPlan(plan);
            onDirty(true);
          }}
          className="space-y-4"
        >
          <fieldset disabled={busy} className="space-y-4">
            {adopting ? (
              <div className="space-y-2 rounded border border-amber-600 p-4">
                <h3 className="font-semibold">Review existing draft for guided preparation</h3>
                <p className="text-sm text-slate-300">
                  Keep this year’s designated rules, positions and operating policy. Set the annual
                  evidence dates and timing explicitly. Every seat’s participation must be reviewed
                  again in stage 2. Shared templates, published configurations and years with a Real
                  session cannot be adopted here.
                </p>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    required
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  I reviewed the existing designated draft and its annual preparation dates.
                </label>
              </div>
            ) : (
              <>
                <label className="block">
                  Start from
                  <select
                    className={fieldClass}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">Blank annual plan</option>
                    {sources.data?.sources
                      .filter((s) => s.year < year)
                      .map((s) => (
                        <option key={s.sessionId} value={s.sessionId}>
                          Verified official {s.year} completion · {s.sessionId}
                        </option>
                      ))}
                  </select>
                </label>
                {sources.data?.notice && (
                  <p className="text-sm text-slate-400">{sources.data.notice}</p>
                )}
                {sources.isError && (
                  <p role="alert">
                    Official sources could not be verified. Blank preparation is available.
                  </p>
                )}
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                Personnel and staffing effective date
                <input
                  required
                  type="date"
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label>
                Credential evaluation date
                <input
                  required
                  type="date"
                  value={qualifications}
                  onChange={(e) => setQualifications(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label>
                Turn timer (seconds)
                <input
                  required
                  type="number"
                  min={30}
                  max={600}
                  value={timer}
                  onChange={(e) => setTimer(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label>
                Expected duration (days)
                <input
                  required
                  type="number"
                  min={1}
                  max={7}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={fieldClass}
                />
              </label>
            </div>
            <label className="block">
              {adopting ? 'Reason for adopting this draft' : 'Reason for starting this plan'}
              <input
                required
                minLength={4}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={fieldClass}
              />
            </label>
            <p className="text-sm text-slate-400">
              Copied rules and topology require annual review. Participants, operational grants and
              annual assignments require their own current evidence.
            </p>
            <button className={buttonClass} disabled={busy} type="submit">
              {busy
                ? 'Saving…'
                : adopting
                  ? 'Adopt reviewed draft into annual preparation'
                  : 'Start annual draft'}
            </button>
          </fieldset>
          {adopting && dirty && (
            <section className="space-y-3">
              <button
                type="button"
                disabled={busy}
                className={buttonClass}
                onClick={async () => {
                  try {
                    const fresh = await annualGet<{ plan: AnnualPlan }>(`annual-plan/${year}`);
                    setReconciliation(expectedPlan(fresh.plan));
                    setMessage(
                      'Review the latest designated configuration before applying these retained annual dates.',
                    );
                  } catch (error) {
                    setMessage(
                      error instanceof Error ? error.message : 'Latest configuration unavailable',
                    );
                  }
                }}
              >
                Review latest configuration without discarding dates
              </button>
              {reconciliation && (
                <div className="rounded border border-amber-600 p-3 text-sm">
                  <p>
                    Rule revision {reconciliation.expected_rule_revision}; configuration revision{' '}
                    {reconciliation.expected_configuration_revision}; source revision{' '}
                    {reconciliation.expected_source_revision}.
                  </p>
                  <button
                    type="button"
                    className={`${buttonClass} mt-2`}
                    onClick={() => {
                      revision.current = reconciliation;
                      pending.current = null;
                      setReconciliation(null);
                      setAccepted(false);
                      setMessage(
                        'Retained dates now use the reviewed revision. Confirm the draft before submitting again.',
                      );
                    }}
                  >
                    Use reviewed revision and keep dates
                  </button>
                </div>
              )}
            </section>
          )}
        </form>
      )}
      {message && (
        <output className="block whitespace-pre-wrap rounded border border-slate-600 p-3">
          {message}
        </output>
      )}
    </div>
  );
}
