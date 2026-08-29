'use client';

import { type FormEvent, useEffect, useState } from 'react';

type AdvisoryKind = 'specialty_priority' | 'eligibility';

interface AdvisoryStatus {
  provider: string;
  mode: string;
  advisoryOnly: boolean;
  mayCommitBid: boolean;
  mayMutatePolicy: boolean;
  mayMutateAssignments: boolean;
}

const fallbackStatus: AdvisoryStatus = {
  provider: 'PENDING_CONFIGURATION',
  mode: 'deterministic_fallback',
  advisoryOnly: true,
  mayCommitBid: false,
  mayMutatePolicy: false,
  mayMutateAssignments: false,
};

function describeError(payload: unknown, fallback: string): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }
  return fallback;
}

/**
 * A compact, no-free-prompt interface for deterministic facts. The Worker
 * never sends this input to an external provider in this release.
 */
export function AiAssistWorkspace() {
  const [status, setStatus] = useState<AdvisoryStatus>(fallbackStatus);
  const [kind, setKind] = useState<AdvisoryKind>('specialty_priority');
  const [subjectReference, setSubjectReference] = useState('Member-017');
  const [policyReference, setPolicyReference] = useState('synthetic-2027.3');
  const [requesterPriority, setRequesterPriority] = useState(4);
  const [higherPriorityCount, setHigherPriorityCount] = useState(3);
  const [policyState, setPolicyState] = useState<'configured' | 'unresolved'>('configured');
  const [eligibility, setEligibility] = useState<'eligible' | 'ineligible'>('eligible');
  const [reasonCodes, setReasonCodes] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/admin/ai-assist/status', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        return (await response.json()) as AdvisoryStatus;
      })
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        // The local fallback boundary remains accurate even when a status
        // read is temporarily unavailable; this page never enables a write.
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setAnswer(null);

    const payload =
      kind === 'specialty_priority'
        ? {
            kind,
            facts: {
              requester_reference: subjectReference.trim(),
              requester_priority: requesterPriority,
              higher_priority_candidate_count: higherPriorityCount,
              policy_reference: policyReference.trim(),
              policy_state: policyState,
            },
          }
        : {
            kind,
            facts: {
              subject_reference: subjectReference.trim(),
              determination: eligibility,
              reason_codes: reasonCodes
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              policy_reference: policyReference.trim(),
            },
          };

    try {
      const response = await fetch('/api/admin/ai-assist/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(describeError(body, `Explanation request failed (${response.status}).`));
        return;
      }
      if (typeof body === 'object' && body !== null && 'explanation' in body) {
        const explanation = body.explanation;
        if (typeof explanation === 'string') {
          setAnswer(explanation);
          return;
        }
      }
      setError('The advisory service returned no explanation.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Explanation request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-700 bg-slate-800/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Decision-support boundary
            </p>
            <h1 className="mt-1 font-heading text-2xl text-white">AI Assist</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Explain structured facts from the deterministic Bid engine in operational language.
              This panel is not a policy editor or a decision maker.
            </p>
          </div>
          <span className="rounded-full border border-amber-600 bg-amber-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-100">
            Deterministic fallback
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-slate-700 bg-slate-900/50 p-3">
            <dt className="text-slate-400">Provider</dt>
            <dd className="mt-1 font-mono text-xs text-white">{status.provider}</dd>
          </div>
          <div className="rounded border border-slate-700 bg-slate-900/50 p-3">
            <dt className="text-slate-400">Mode</dt>
            <dd className="mt-1 text-white">{status.mode.replaceAll('_', ' ')}</dd>
          </div>
          <div className="rounded border border-slate-700 bg-slate-900/50 p-3">
            <dt className="text-slate-400">Authority</dt>
            <dd className="mt-1 text-white">Advisory only</dd>
          </div>
          <div className="rounded border border-slate-700 bg-slate-900/50 p-3">
            <dt className="text-slate-400">External provider</dt>
            <dd className="mt-1 text-white">Not configured</dd>
          </div>
        </dl>

        <ul className="mt-4 grid gap-2 text-sm text-amber-100 sm:grid-cols-3">
          <li className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2">
            It does not make awards.
          </li>
          <li className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2">
            It does not change policy.
          </li>
          <li className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2">
            It does not change assignments or publish to the portal.
          </li>
        </ul>
      </section>

      <form
        onSubmit={submit}
        className="rounded-lg border border-slate-700 bg-slate-800/40 p-5"
        aria-describedby="ai-assist-facts-help"
      >
        <div>
          <h2 className="font-heading text-lg text-white">Explain supplied facts</h2>
          <p id="ai-assist-facts-help" className="mt-1 max-w-3xl text-sm text-slate-300">
            Use an anonymous member reference rather than a name. The fallback validates the
            structured facts locally and does not send them to an external model.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-slate-200">Explanation</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as AdvisoryKind)}
              className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
            >
              <option value="specialty_priority">Specialty priority</option>
              <option value="eligibility">Eligibility</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-slate-200">Anonymous member reference</span>
            <input
              required
              maxLength={128}
              value={subjectReference}
              onChange={(event) => setSubjectReference(event.target.value)}
              placeholder="Member-017"
              className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm text-slate-200">Frozen policy reference</span>
            <input
              required
              maxLength={128}
              value={policyReference}
              onChange={(event) => setPolicyReference(event.target.value)}
              placeholder="2027.3"
              className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-white"
            />
          </label>
        </div>

        {kind === 'specialty_priority' ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm text-slate-200">Requester priority</span>
              <input
                required
                type="number"
                min={1}
                max={10000}
                value={requesterPriority}
                onChange={(event) => setRequesterPriority(Number(event.target.value))}
                className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              />
            </label>
            <label className="block">
              <span className="text-sm text-slate-200">Higher-priority eligible candidates</span>
              <input
                required
                type="number"
                min={0}
                max={10000}
                value={higherPriorityCount}
                onChange={(event) => setHigherPriorityCount(Number(event.target.value))}
                className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              />
            </label>
            <label className="block">
              <span className="text-sm text-slate-200">Policy status</span>
              <select
                value={policyState}
                onChange={(event) =>
                  setPolicyState(event.target.value as 'configured' | 'unresolved')
                }
                className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="configured">Configured</option>
                <option value="unresolved">Unresolved — block flow</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-slate-200">Deterministic eligibility result</span>
              <select
                value={eligibility}
                onChange={(event) =>
                  setEligibility(event.target.value as 'eligible' | 'ineligible')
                }
                className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="eligible">Eligible</option>
                <option value="ineligible">Ineligible</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-slate-200">Reason codes (comma-separated)</span>
              <input
                maxLength={1000}
                value={reasonCodes}
                onChange={(event) => setReasonCodes(event.target.value)}
                placeholder="SPECIALTY_CREDENTIAL_MISSING"
                className="mt-1 block min-h-[44px] w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Explaining…' : 'Explain supplied facts'}
          </button>
          <p className="text-xs text-slate-400">
            No prompt, chat history, or decision is retained.
          </p>
        </div>

        {error !== null && (
          <output
            aria-live="polite"
            className="mt-4 block rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-100"
          >
            {error}
          </output>
        )}
        {answer !== null && (
          <output
            aria-live="polite"
            className="mt-4 block rounded border border-emerald-800 bg-emerald-950/20 p-4 text-sm leading-6 text-emerald-50"
          >
            {answer}
          </output>
        )}
      </form>
    </div>
  );
}
