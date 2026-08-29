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

export interface EligibilityMemberOption {
  id: number;
  firstName: string;
  lastName: string;
  rank: string;
}

export interface EligibilityPositionOption {
  id: string;
  positionName: string;
  station: string;
  unit: string;
  rankRequired: string;
}

interface Props {
  ruleBookVersion: string;
  positionTemplateVersion: string;
  members: readonly EligibilityMemberOption[];
  positions: readonly EligibilityPositionOption[];
}

export function EligibilityPreviewForm({
  ruleBookVersion,
  positionTemplateVersion,
  members,
  positions,
}: Props) {
  const [memberId, setMemberId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (memberId === '') {
      setError('Select a member from the configured roster.');
      setResult(null);
      return;
    }
    if (positionId === '') {
      setError('Select a position from the configured template.');
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        member_id: Number(memberId),
        position_id: positionId,
        rule_book_version: ruleBookVersion,
      };
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
          <span className="text-sm text-slate-300">Member</span>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            data-testid="eligibility-member-id"
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-white"
            required
          >
            <option value="">Select a member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.lastName}, {member.firstName} — {member.rank}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Position</span>
          <select
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            data-testid="eligibility-position-id"
            className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-white"
            required
          >
            <option value="">Select a configured position</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.id} — {position.positionName} ({position.station} / {position.unit} /{' '}
                {position.rankRequired})
              </option>
            ))}
          </select>
        </label>
        <div className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200">
          <span className="font-medium">Selected annual configuration</span>
          <span className="ml-2 text-slate-400">Rule book:</span>{' '}
          <output data-testid="eligibility-rule-book-version" className="font-mono text-white">
            {ruleBookVersion}
          </output>
          <span className="ml-3 text-slate-400">Position template:</span>{' '}
          <span className="font-mono text-white">{positionTemplateVersion}</span>
        </div>
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
