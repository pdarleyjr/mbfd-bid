'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  type AnnualPlan,
  annualGet,
  annualPost,
  buttonClass,
  fieldClass,
} from './annual-plan-client';
type Score = {
  eligible: boolean;
  points: number;
  soPoints: number;
  moPoints: number;
  priority: number | null;
  reasons: string[];
};
type ImpactChange = { positionId: string; memberId: number; before: Score; after: Score };
type Review = {
  ready: boolean;
  ruleRevision: number;
  configurationRevision: number;
  sourceRevision: number;
  blockers: { code: string; detail: string }[];
  sourceSessionId: string | null;
  comparisonSource: 'official' | 'last_review';
  checkpoint: { sourceRevision: number; reviewedAt: number } | null;
  changes: { positionId: string; kind: string; fields: string[] }[];
  participants: { included: number; excluded: number } | null;
  impact: {
    scope: string;
    available: boolean;
    evaluatedComparisons: number;
    changed: ImpactChange[];
    evidenceScope: string;
    priorityScope: string;
    evidence: { evaluatedComparisons: number; changed: ImpactChange[] };
    incomparable: {
      addedMemberIds: number[];
      removedMemberIds: number[];
      addedPositionIds: string[];
      removedPositionIds: string[];
    } | null;
  };
};
export function AnnualPlanReview({
  plan,
  onDirty,
  onSaved,
}: { plan: AnnualPlan; onDirty(value: boolean): void; onSaved(): Promise<void> }) {
  const [baseline, setBaseline] = useState('official');
  const [comparison, setComparison] = useState('policy');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef<{
    expected_rule_revision: number;
    expected_configuration_revision: number;
    expected_source_revision: number;
  } | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  useUnsavedChanges(!!(reason || accepted), 'annual source review');
  const review = useQuery({
    queryKey: [
      'admin',
      'annual-plan',
      plan.year,
      'review',
      baseline,
      plan.ruleBookRevision,
      plan.configurationRevision,
      plan.sourceRevision,
    ],
    queryFn: () => annualGet<Review>(`annual-plan/${plan.year}/review?baseline=${baseline}`),
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const data = review.data;
  const score = (s: Score) =>
    s.eligible
      ? `${s.points} total · ${s.soPoints} SO · ${s.moPoints} MO · Priority ${s.priority ?? 'unavailable'}`
      : `Ineligible${s.reasons?.length ? `: ${s.reasons.join('; ')}` : ''}`;
  const impact = comparison === 'policy' ? data?.impact : data?.impact.evidence;
  const filtered =
    impact?.changed.filter((row) =>
      `${row.positionId} ${row.memberId}`.toLowerCase().includes(filter.trim().toLowerCase()),
    ) ?? [];
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <div className="space-y-5">
      <Label className="block max-w-lg">
        Comparison baseline
        <NativeSelect
          className={fieldClass}
          value={baseline}
          onChange={(e) => {
            setBaseline(e.target.value);
            setPage(0);
          }}
        >
          <option value="official">Selected official completion</option>
          <option value="last_review">Last saved source review</option>
        </NativeSelect>
      </Label>
      <Button
        type="button"
        className={buttonClass}
        disabled={review.isFetching}
        onClick={() => void review.refetch()}
      >
        {review.isFetching ? 'Checking…' : 'Refresh readiness and impact'}
      </Button>
      {review.isPending && (
        <p>Checking designated rules, source evidence and session preparation…</p>
      )}
      {review.isError && (
        <p role="alert" className="text-warning">
          {review.error.message}. {data ? 'The last successful review remains visible.' : ''}
        </p>
      )}
      {data && (
        <>
          <p
            className={`rounded border p-4 ${data.ready ? 'border-success/40 text-success' : 'border-warning/40 text-warning'}`}
          >
            {data.ready
              ? 'Preparation checks passed for these revisions.'
              : 'Preparation is blocked.'}{' '}
            Rules {data.ruleRevision} · Configuration {data.configurationRevision} · Source{' '}
            {data.sourceRevision}
          </p>
          {data.blockers.length > 0 && (
            <ul className="space-y-3">
              {data.blockers.map((b) => (
                <li key={b.code} className="rounded border border-border p-3">
                  <h3 className="font-semibold">{b.code.replaceAll('_', ' ')}</h3>
                  <p className="mt-1 text-sm text-foreground">{b.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {data.participants && (
            <p>
              {data.participants.included} included participants; {data.participants.excluded}{' '}
              excluded by the shared annual preparation rules.
            </p>
          )}
          <details className="rounded border border-border p-4">
            <summary className="cursor-pointer font-semibold">
              What changed ({data.changes.length} position changes)
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">
              {data.comparisonSource === 'last_review'
                ? data.checkpoint
                  ? `Compared with saved source revision ${data.checkpoint.sourceRevision}.`
                  : 'No source review has been saved yet.'
                : data.sourceSessionId
                  ? `Compared with verified completion ${data.sourceSessionId}.`
                  : 'No comparable baseline is selected. These positions are the current draft inventory; they are not proven additions.'}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {data.changes.map((c) => (
                <li key={c.positionId}>
                  {c.positionId} · {c.kind.toLowerCase()}
                  {c.fields.length ? ` · ${c.fields.join(', ')}` : ''}
                </li>
              ))}
            </ul>
          </details>
          <section className="space-y-3">
            <h3 className="font-heading text-lg">Eligibility impact</h3>
            <p className="text-sm text-muted-foreground">{data.impact.scope}</p>
            {data.impact.available ? (
              <>
                <p>
                  Each comparison measures member-position combinations. Added or removed members
                  and positions are outside the matching comparison and listed separately.
                </p>
                <p className="text-sm text-muted-foreground">{data.impact.priorityScope}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Label>
                    Comparison
                    <NativeSelect
                      className={fieldClass}
                      value={comparison}
                      onChange={(e) => {
                        setComparison(e.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="policy">Rule changes on current evidence</option>
                      <option value="evidence">Evidence changes under prior rules</option>
                    </NativeSelect>
                  </Label>
                  <Label>
                    Filter by position or member ID
                    <Input
                      className={fieldClass}
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(0);
                      }}
                    />
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  {comparison === 'policy' ? data.impact.scope : data.impact.evidenceScope}
                </p>
                <p>
                  {impact?.evaluatedComparisons ?? 0} evaluated member-position combinations;{' '}
                  {impact?.changed.length ?? 0} changed; {filtered.length} match this filter.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {filtered.slice(currentPage * 50, (currentPage + 1) * 50).map((change) => (
                    <article
                      className="min-w-0 rounded border border-border p-3 text-sm"
                      key={`${change.positionId}:${change.memberId}`}
                    >
                      <h4 className="break-words font-semibold">
                        {change.positionId} · Member {change.memberId}
                      </h4>
                      <p className="mt-2">
                        {comparison === 'policy' ? 'Prior rules' : 'Prior evidence'}:{' '}
                        {score(change.before)}
                      </p>
                      <p>
                        {comparison === 'policy' ? 'Upcoming rules' : 'Upcoming evidence'}:{' '}
                        {score(change.after)}
                      </p>
                    </article>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    className={buttonClass}
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous results
                  </Button>
                  <span>
                    Page {currentPage + 1} of {pageCount}
                  </span>
                  <Button
                    type="button"
                    className={buttonClass}
                    disabled={currentPage + 1 >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next results
                  </Button>
                  <Button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob(
                          [
                            JSON.stringify(
                              {
                                year: plan.year,
                                exportedAt: new Date().toISOString(),
                                review: data,
                              },
                              null,
                              2,
                            ),
                          ],
                          { type: 'application/json' },
                        ),
                      );
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `annual-impact-${plan.year}-source-${data.sourceRevision}.json`;
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    Export full review and impact
                  </Button>
                </div>
                {data.impact.incomparable && (
                  <details className="rounded border border-border p-4">
                    <summary className="cursor-pointer font-semibold">
                      Added, removed or incomparable evidence
                    </summary>
                    <ul className="mt-3 space-y-2 break-words text-sm">
                      <li>
                        {data.impact.incomparable.addedMemberIds.length} added participants:{' '}
                        {data.impact.incomparable.addedMemberIds.join(', ') || 'None'}
                      </li>
                      <li>
                        {data.impact.incomparable.removedMemberIds.length} removed participants:{' '}
                        {data.impact.incomparable.removedMemberIds.join(', ') || 'None'}
                      </li>
                      <li>
                        {data.impact.incomparable.addedPositionIds.length} added rule positions:{' '}
                        {data.impact.incomparable.addedPositionIds.join(', ') || 'None'}
                      </li>
                      <li>
                        {data.impact.incomparable.removedPositionIds.length} removed rule positions:{' '}
                        {data.impact.incomparable.removedPositionIds.join(', ') || 'None'}
                      </li>
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="text-warning">
                Impact requires accepted upcoming session preparation and comparable evidence from
                the selected baseline. No missing baseline is replaced with current data.
              </p>
            )}
          </section>
          <form
            className="space-y-3 rounded border border-border p-4"
            onChange={() => {
              if (!revision.current)
                revision.current = {
                  expected_rule_revision: data.ruleRevision,
                  expected_configuration_revision: data.configurationRevision,
                  expected_source_revision: data.sourceRevision,
                };
              onDirty(true);
            }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (!revision.current) return;
              const body = { ...revision.current, reason, accept_review: accepted };
              const fingerprint = JSON.stringify(body);
              if (pending.current?.fingerprint !== fingerprint)
                pending.current = { fingerprint, key: crypto.randomUUID() };
              setBusy(true);
              setMessage('');
              try {
                await annualPost(`annual-plan/${plan.year}/review`, body, pending.current.key);
                setReason('');
                setAccepted(false);
                revision.current = null;
                pending.current = null;
                onDirty(false);
                await onSaved();
                await review.refetch();
                setMessage(
                  'Source review saved. Later comparisons can use this exact evidence; the plan remains subject to rehearsal and freeze checks.',
                );
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Source review unavailable');
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset
              disabled={busy || plan.lifecycle !== 'DRAFT' || review.isPlaceholderData}
              className="space-y-3"
            >
              <h3 className="font-heading text-lg">Save reviewed source for comparison</h3>
              <p className="text-sm text-muted-foreground">
                Save the prepared evidence behind this review so future changes can be compared with
                it. This records review evidence and does not publish rules or approve a freeze.
              </p>
              <Label className="block">
                Source review reason
                <Input
                  required
                  minLength={4}
                  maxLength={500}
                  className={fieldClass}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Label>
              <Label className="flex min-h-11 items-center gap-3">
                <Input
                  type="checkbox"
                  required
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                I reviewed the displayed source and configuration revisions.
              </Label>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" className={buttonClass}>
                  Save source review checkpoint
                </Button>
                {!!(reason || accepted) && (
                  <Button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      revision.current = {
                        expected_rule_revision: data.ruleRevision,
                        expected_configuration_revision: data.configurationRevision,
                        expected_source_revision: data.sourceRevision,
                      };
                      pending.current = null;
                      setAccepted(false);
                      setMessage(
                        'Retained reason now uses the displayed revisions. Review and confirm them before submitting again.',
                      );
                    }}
                  >
                    Use displayed revisions and retain reason
                  </Button>
                )}
              </div>
            </fieldset>
            {message && <output className="block whitespace-pre-wrap text-sm">{message}</output>}
          </form>
        </>
      )}
    </div>
  );
}
