'use client';

import { type FormEvent, useState } from 'react';

interface EligibilityReason {
  code: string;
  label: string;
  satisfied: boolean;
}

interface PreviewResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  points: number;
}

export function EligibilityPreviewForm() {
  const [memberId, setMemberId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [version, setVersion] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        member_id: Number(memberId),
        position_id: positionId.trim(),
      };
      if (version.trim() !== '') body.rule_book_version = version.trim();
      const res = await fetch('/api/admin/eligibility/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errBody.error ?? `Preview failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as PreviewResult);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-slate-300">Member ID</span>
          <input
            type="number"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Position ID</span>
          <input
            type="text"
            value={positionId}
            onChange={(e) => setPositionId(e.target.value.toUpperCase())}
            placeholder="A101"
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 font-mono text-white"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">
            Rule-book version (required when multiple active annual books exist)
          </span>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="2026.1"
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 font-mono text-white"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
        >
          Evaluate
        </button>
      </form>

      {error !== null && (
        <output aria-live="polite" className="mt-4 block text-sm text-red-400">
          {error}
        </output>
      )}

      {result !== null && (
        <div className="mt-6 rounded border border-slate-700 bg-slate-800 p-4">
          <p className="text-sm">
            <span className="text-slate-400">Eligible:</span>{' '}
            <span
              className={`font-semibold ${result.eligible ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {result.eligible ? 'YES' : 'NO'}
            </span>
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Points: <span className="tabular-nums text-white">{result.points}</span>
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {result.reasons.map((r) => (
              <li key={r.code}>
                <span
                  className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs ${
                    r.satisfied ? 'bg-emerald-800 text-emerald-200' : 'bg-red-800 text-red-200'
                  }`}
                >
                  {r.code}
                </span>
                <span className="text-slate-200">{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
