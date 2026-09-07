'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { annualGet, annualPost, fieldClass } from '../annual-plan/annual-plan-client';

type Issue = {
  issue_id: string;
  revision: number;
  title: string;
  question: string;
  area: 'positions' | 'rules' | 'annual-policy' | 'annual-plan';
  status: 'OPEN' | 'RESOLVED';
  decision: string;
  source_ref: string;
  effective_on: string;
  actor_subject?: string;
  created_at?: number;
};
const CHECKS: [string, string, Issue['area'], string][] = [
  [
    'authority',
    'Adopted 2026 source package',
    'annual-policy',
    'Confirm the applicable standalone 2026 Bid Policy v3 and OneDrive_1_8-25-2026.zip documents, including later amendments. A document title alone does not reconcile conflicting provisions.',
  ],
  [
    'marine',
    'Marine mandatory qualifications',
    'rules',
    'Compare mandatory Marine qualifications in the policy with the workbook statement that other Marine positions require none. Points cannot substitute for mandatory qualifications.',
  ],
  [
    'operations',
    'Special Operations scoring',
    'rules',
    'Confirm the six Operations prerequisites, Technician bonus interpretation, group and total caps, and ranking order against the adopted language.',
  ],
  [
    'air-tech',
    'Air Tech requirements versus preferences',
    'rules',
    'The workbook treats Car Seat Technician as required where policy uses preferred language. Confirm primary and backup role requirements separately.',
  ],
  [
    'investigator',
    'Investigator specialty scope',
    'annual-policy',
    'Reconcile Investigator eligibility and preferred qualifications with the narrower later list of firefighter specialty bids. Preserve the specified apparatus assignment.',
  ],
  [
    'counts',
    'Position counts and availability',
    'positions',
    'The supplied master contains 234 enabled position rows (A76/B75/C75/D8), while shift summaries report 74. Reconcile against the current authorized structure; occupied, authorized, excluded and bid-open counts differ.',
  ],
  [
    'station-six',
    'Station 6 and Marine topology',
    'positions',
    'The policy references Marine Station 6 while the workbook source does not supply that station configuration. Inspect the existing reviewed Station 6 setup and its decision evidence before changing it.',
  ],
  [
    'timeline',
    'Bid timeline and qualification cutoff',
    'annual-plan',
    'Confirm the approved bid start, qualification cutoff, annual assignment start, and referenced timeline. Do not substitute an upload date for a policy cutoff.',
  ],
  [
    'labor-changes',
    'Subsequent Labor/Management changes',
    'annual-policy',
    'Record each later approved position, rule or procedure amendment with its effective date and affected scope.',
  ],
  [
    'daily-staffing',
    'Daily staffing versus annual bid capacity',
    'positions',
    'Daily minimum staffing, Air Tech daily coverage and prescheduled staffing are separate from annual bid capacity. Do not use the daily minimum as the annual seat total.',
  ],
];
const empty = (): Issue => ({
  issue_id: crypto.randomUUID(),
  revision: 0,
  title: '',
  question: '',
  area: 'annual-policy',
  status: 'OPEN',
  decision: '',
  source_ref: '',
  effective_on: '',
});
export function SourceReviewWorkspace() {
  const params = useSearchParams();
  const n = Number(params.get('year'));
  const year = Number.isInteger(n) && n >= 2024 && n <= 2100 ? n : new Date().getFullYear();
  const data = useQuery({
    queryKey: ['source-decisions', year],
    queryFn: () =>
      annualGet<{
        history: Issue[];
        documents: {
          id: string;
          rule_book_version: string;
          revision: number;
          status: string;
          policy_text: string;
        }[];
      }>(`source-decisions/${year}`),
  });
  const [draft, setDraft] = useState<Issue | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const latest =
    data.data?.history.filter(
      (row, i, all) => all.findIndex((r) => r.issue_id === row.issue_id) === i,
    ) ?? [];
  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await annualPost(
        `source-decisions/${year}`,
        {
          issue_id: draft.issue_id,
          expected_revision: draft.revision,
          title: draft.title,
          question: draft.question,
          area: draft.area,
          status: draft.status,
          decision: draft.decision,
          source_ref: draft.source_ref,
          effective_on: draft.effective_on,
        },
        crypto.randomUUID(),
      );
      setDraft(null);
      await data.refetch();
      setMessage(
        'Decision recorded. Apply any resulting configuration changes and refresh impact review and practice.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <h1 className="font-heading text-3xl">Source decisions and changes — {year}</h1>
      <p>
        Keep policy questions beside the affected configuration. An open recorded issue prevents a
        new setup from being approved. Recording a resolution does not edit a rule or rewrite an
        existing bid.
      </p>
      <Link className="underline" href={`/admin/annual-plan?year=${year}&stage=6` as Route}>
        Return to annual impact review
      </Link>
      {data.error && (
        <p role="alert">
          {data.error.message}{' '}
          <Button variant="secondary" onClick={() => void data.refetch()}>
            Retry
          </Button>
        </p>
      )}
      <Button disabled={busy || data.isPending || data.isError} onClick={() => setDraft(empty())}>
        Record a new change or question
      </Button>
      {latest.map((issue) => (
        <article key={issue.issue_id} className="rounded border border-border p-4">
          <h2 className="font-semibold">
            {issue.title} · {issue.status === 'OPEN' ? 'Needs decision' : 'Decision recorded'}
          </h2>
          <p className="my-2">{issue.question}</p>
          <p>{issue.decision}</p>
          <p className="text-sm text-muted-foreground">
            {issue.source_ref} · Effective {issue.effective_on}
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            <Button variant="secondary" disabled={busy} onClick={() => setDraft(issue)}>
              Review or revise decision
            </Button>
            <Link className="underline" href={`/admin/${issue.area}?year=${year}` as Route}>
              Open affected configuration
            </Link>
          </div>
          <details className="mt-3">
            <summary>Decision history</summary>
            {data.data?.history
              .filter((r) => r.issue_id === issue.issue_id)
              .map((r) => (
                <p className="my-2 text-sm" key={r.revision}>
                  Revision {r.revision}: {r.status} — {r.decision} ({r.source_ref})
                </p>
              ))}
          </details>
        </article>
      ))}
      {year === 2026 && (
        <details className="rounded border border-border p-4" open>
          <summary>2026 source checks</summary>
          <p className="my-3 text-sm">
            These are discrepancies observed in the supplied documents, not automatic changes to the
            existing approved configuration. Open each applicable check, inspect the current setup
            and record either the supporting resolution or an unresolved issue.
          </p>
          {CHECKS.map(([id, title, area, question]) => (
            <div key={id} className="my-3 border-t border-border pt-3">
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm">{question}</p>
              <Button
                className="mt-2"
                variant="secondary"
                disabled={busy || data.isPending || data.isError}
                onClick={() =>
                  setDraft(
                    latest.find((i) => i.issue_id === id) ?? {
                      ...empty(),
                      issue_id: id,
                      title,
                      area,
                      question,
                      source_ref: '2026 Bid Policy v3.docx; OneDrive_1_8-25-2026.zip',
                    },
                  )
                }
              >
                Review this source check
              </Button>
            </div>
          ))}
        </details>
      )}
      {draft && (
        <section className="space-y-4 rounded border border-border p-5">
          <h2 className="font-semibold">Record the reviewed source decision</h2>
          <Label className="block">
            Title
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Label>
          <Label className="block">
            What changes or needs a decision?
            <textarea
              className={fieldClass}
              value={draft.question}
              onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            />
          </Label>
          <Label className="block">
            Affected area
            <NativeSelect
              value={draft.area}
              onChange={(e) => setDraft({ ...draft, area: e.target.value as Issue['area'] })}
            >
              <option value="positions">Positions</option>
              <option value="rules">Requirements and points</option>
              <option value="annual-policy">Operating policy</option>
              <option value="annual-plan">Annual preparation and dates</option>
            </NativeSelect>
          </Label>
          <Label className="block">
            Decision status
            <NativeSelect
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as Issue['status'] })}
            >
              <option value="OPEN">Needs a decision — blocks new approval</option>
              <option value="RESOLVED">Resolved by supporting authority</option>
            </NativeSelect>
          </Label>
          <Label className="block">
            Decision or reason it remains open
            <textarea
              className={fieldClass}
              value={draft.decision}
              onChange={(e) => setDraft({ ...draft, decision: e.target.value })}
            />
          </Label>
          <Label className="block">
            Supporting policy, amendment or approved decision
            <Input
              value={draft.source_ref}
              onChange={(e) => setDraft({ ...draft, source_ref: e.target.value })}
            />
          </Label>
          <Label className="block">
            Applies from
            <Input
              type="date"
              value={draft.effective_on}
              onChange={(e) => setDraft({ ...draft, effective_on: e.target.value })}
            />
          </Label>
          <Button
            disabled={
              busy ||
              !draft.effective_on ||
              [draft.title, draft.question, draft.decision, draft.source_ref].some(
                (v) => v.trim().length < 4,
              )
            }
            onClick={() => void save()}
          >
            Save source decision
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
            Cancel editor
          </Button>
        </section>
      )}
      {message && <output className="block">{message}</output>}
      <details className="rounded border border-border p-4">
        <summary>Policy language already stored in this year</summary>
        {data.data?.documents.map((doc) => (
          <details key={doc.id} className="mt-4">
            <summary>
              {doc.rule_book_version} · revision {doc.revision} · {doc.status}
            </summary>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">{doc.policy_text}</pre>
          </details>
        ))}
        {data.data && !data.data.documents.length && (
          <p>No policy document is stored for this year. Add its language in Operating policy.</p>
        )}
      </details>
    </main>
  );
}
