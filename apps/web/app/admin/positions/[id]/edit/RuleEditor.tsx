'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft } from '../../../../../lib/draft-storage';

const routeFor = (pid: string): string => `/admin/positions/${pid}/edit`;

interface DraftValues {
  ruleId: number;
  required: string;
  points: string;
  tie: string;
}

interface InitialRule {
  id: number;
  requiredCriteria: unknown;
  pointsPreference: unknown;
  tieBreakChain: unknown;
}

export function RuleEditor({
  positionId,
  initialRule,
}: {
  positionId: string;
  initialRule?: InitialRule;
}) {
  const router = useRouter();
  const [ruleId, setRuleId] = useState<number | null>(null);
  const [required, setRequired] = useState('');
  const [points, setPoints] = useState('');
  const [tie, setTie] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Hydrate the editor either from a saved draft (preferred) or by surfacing a
  // hint to the operator to point at an existing rule_id via URL hash.
  useEffect(() => {
    const d = loadDraft<DraftValues>(routeFor(positionId), 'rule');
    if (d !== null) {
      setRuleId(d.values.ruleId);
      setRequired(d.values.required);
      setPoints(d.values.points);
      setTie(d.values.tie);
    } else if (initialRule !== undefined) {
      setRuleId(initialRule.id);
      setRequired(JSON.stringify(initialRule.requiredCriteria, null, 2));
      setPoints(JSON.stringify(initialRule.pointsPreference, null, 2));
      setTie(JSON.stringify(initialRule.tieBreakChain));
    } else {
      // Default skeleton; operator must supply rule_id (typically via the parent
      // /admin/rules table — a deep link would prefill this in a richer build).
      setRequired('{"rank":["FF"],"credentials":[],"custom":[]}');
      setPoints('{"max":0,"items":[]}');
      setTie('["points","rsc_seniority","rank_seniority"]');
    }
  }, [positionId, initialRule]);

  // Autosave debounced
  useEffect(() => {
    if (ruleId === null) return;
    const t = setTimeout(() => {
      saveDraft(routeFor(positionId), 'rule', { ruleId, required, points, tie });
    }, 500);
    return () => clearTimeout(t);
  }, [ruleId, required, points, tie, positionId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (ruleId === null) {
      setError('Set the position_rules.id to edit (rule_id input below).');
      return;
    }
    let reqJson: unknown;
    let ptsJson: unknown;
    let tieJson: unknown;
    try {
      reqJson = JSON.parse(required);
      ptsJson = JSON.parse(points);
      tieJson = JSON.parse(tie);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          required_criteria: reqJson,
          points_preference: ptsJson,
          tie_break_chain: tieJson,
          reason_code: 'rule_override.fix_misconfig',
          reason: reason.trim(),
        }),
      });
      if (res.status === 401) {
        const body = (await res.json()) as { error: string };
        if (body.error === 'step_up_required') {
          setError('Session stale — please re-authenticate.');
        } else {
          setError('Auth failed.');
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      deleteDraft(routeFor(positionId), 'rule');
      setToast('Rule saved');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {initialRule !== undefined ? (
        <p className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300">
          Editing draft rule <span className="font-mono text-slate-100">#{initialRule.id}</span> for{' '}
          <span className="font-mono text-slate-100">{positionId}</span>.
        </p>
      ) : (
        <label className="block">
          <span className="text-sm text-slate-300">Rule ID (position_rules.id)</span>
          <input
            type="number"
            value={ruleId ?? ''}
            onChange={(e) => setRuleId(e.target.value === '' ? null : Number(e.target.value))}
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
            required
          />
        </label>
      )}

      <label className="block">
        <span className="text-sm text-slate-300">Required criteria (JSON)</span>
        <textarea
          value={required}
          onChange={(e) => setRequired(e.target.value)}
          rows={4}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 font-mono text-xs text-white"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-300">Points preference (JSON)</span>
        <textarea
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          rows={6}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 font-mono text-xs text-white"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-300">Tie-break chain (JSON array)</span>
        <input
          type="text"
          value={tie}
          onChange={(e) => setTie(e.target.value)}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 font-mono text-xs text-white"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-300">Reason (min 4 chars)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-sm text-white"
          required
        />
      </label>

      {error !== null && (
        <output aria-live="polite" className="block text-sm text-red-400">
          {error}
        </output>
      )}
      {toast !== null && (
        <output aria-live="polite" className="block text-sm text-emerald-400">
          {toast}
        </output>
      )}

      <button
        type="submit"
        disabled={submitting || reason.trim().length < 4}
        className="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
      >
        Save rule
      </button>
    </form>
  );
}
