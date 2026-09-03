'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';

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
  actorMemberId: number;
}

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
const dispositions = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'] as const;

function workerError(value: unknown, fallback: string): string {
  return typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : fallback;
}

function makeExecutionPolicy(stages: string[], actorMemberId: number) {
  return {
    v: 1,
    policyRevision: `operator-draft-${crypto.randomUUID()}`,
    stages: stages.map((label, order) => ({
      id: `STAGE_${order + 1}`,
      label,
      order,
      memberIds: [actorMemberId],
      opportunityPositionIds: [`POLICY_STAGE_${order + 1}`],
      kind: 'MIXED',
    })),
    dispositions: dispositions.map((disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: disposition === 'DECLINED',
      requiresReason: true,
      requiresEvidence: disposition === 'UNREACHABLE',
      contactPolicyReference: null,
    })),
    actionPermissions: actions.map((action) => ({ action, actorMemberIds: [actorMemberId] })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
}

/** A form-only editor: it never asks an operator to paste executable JSON. */
export function AnnualPolicyWorkspace({ year, documents, loadError, actorMemberId }: Props) {
  const router = useRouter();
  const [ruleBookVersion, setRuleBookVersion] = useState(
    documents[0]?.rule_book_version ?? `${year}.1`,
  );
  const [language, setLanguage] = useState('');
  const [stageList, setStageList] = useState('Command, Captains, Lieutenants, Firefighters');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stages = useMemo(
    () =>
      stageList
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    [stageList],
  );

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stages.length === 0) return setError('Add at least one named bid stage.');
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/annual-policy-documents/${year}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_book_version: ruleBookVersion.trim(),
          policy_text: language.trim(),
          execution_policy: makeExecutionPolicy(stages, actorMemberId),
          reason: reason.trim(),
        }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok)
        return setError(workerError(result, `Draft creation failed (${response.status}).`));
      setSuccess('Draft saved. The server assigned its revision; refresh to inspect it.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Draft creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function publish(document: AnnualPolicyDocument) {
    const publishReason = window.prompt('Publication reason (4–500 characters):');
    if (publishReason === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(
        `/api/admin/annual-policy-documents/${year}/${document.id}/publish`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: publishReason }),
        },
      );
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok)
        return setError(workerError(result, `Publication failed (${response.status}).`));
      setSuccess(
        `Revision ${document.revision} is published; prior published language is superseded.`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Publication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Annual policy lifecycle
        </p>
        <h1 className="mt-1 font-heading text-2xl text-white">Policy editor — {year}</h1>
        <p className="mt-2 text-sm text-slate-300">
          Language and execution stages are entered as reviewable form fields. Published revisions
          are immutable; edits create a new revision.
        </p>
      </header>
      {loadError ? (
        <p className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
          {loadError}
        </p>
      ) : null}
      <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
        <h2 className="font-heading text-lg text-white">Create policy draft</h2>
        <form className="mt-4 space-y-4" onSubmit={createDraft}>
          <label className="block">
            <span className="text-sm text-slate-200">Draft rule-book version</span>
            <input
              required
              value={ruleBookVersion}
              onChange={(e) => setRuleBookVersion(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">Policy language</span>
            <textarea
              required
              minLength={20}
              maxLength={100000}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              rows={8}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">Bid stages, in order</span>
            <input
              required
              value={stageList}
              onChange={(e) => setStageList(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Comma-separated names, preview: {stages.join(' → ') || 'none'}.
            </span>
          </label>
          <p className="rounded border border-slate-600 bg-slate-900/40 px-3 py-2 text-sm text-slate-300">
            The authenticated administrator is the only initial operator assigned to this draft.
            Publication remains a separate, step-up-protected action.
          </p>
          <label className="block">
            <span className="text-sm text-slate-200">Reason</span>
            <textarea
              required
              minLength={4}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
            />
          </label>
          {error ? <output className="block text-sm text-red-300">{error}</output> : null}
          {success ? <output className="block text-sm text-emerald-300">{success}</output> : null}
          <button
            type="submit"
            disabled={busy || language.trim().length < 20 || reason.trim().length < 4}
            className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Save new draft revision'}
          </button>
        </form>
      </section>
      <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-5">
        <h2 className="font-heading text-lg text-white">Revision history</h2>
        <div className="mt-3 space-y-3">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-300">No policy document is recorded for this year.</p>
          ) : (
            documents.map((document) => (
              <article key={document.id} className="rounded border border-slate-700 p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-mono text-sm text-white">
                    Revision {document.revision} · {document.status}
                  </p>
                  {document.status === 'DRAFT' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void publish(document)}
                      className="rounded border border-emerald-700 px-3 py-1 text-sm text-emerald-200 disabled:opacity-50"
                    >
                      Publish revision
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">
                  {document.policy_text}
                </p>
                {document.supersedes_document_id ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Supersedes {document.supersedes_document_id}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
