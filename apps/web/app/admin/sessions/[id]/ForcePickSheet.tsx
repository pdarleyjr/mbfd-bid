'use client';

import { useState } from 'react';

export function ForcePickSheet({
  sessionId,
  open,
  onClose,
  onDone,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [code, setCode] = useState<'force.reverse_seniority' | 'force.cert_mandate'>(
    'force.reverse_seniority',
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (memberId === '' || positionId === '' || reason.trim().length < 4) {
      setError('Member ID, Position ID, and reason (>=4 chars) are all required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          member_id: Number(memberId),
          position_id: positionId.toUpperCase(),
          reason_code: code,
          reason,
        }),
      });
      if (res.status === 201) {
        onDone();
        return;
      }
      if (res.status === 401) {
        setError('Step-up auth required. Re-authenticate from the controls panel.');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(`Force-pick failed: ${body.error ?? res.status}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      open
      aria-labelledby="force-title"
      className="fixed inset-0 z-50 flex bg-black/40 md:items-stretch md:justify-end"
    >
      <div className="ml-auto h-full w-full bg-slate-900 p-6 text-white shadow-xl md:max-w-md">
        <h2 id="force-title" className="font-heading text-lg">
          Force pick
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Eligibility is BYPASSED. The bid is recorded with forced=true and your admin id.
        </p>
        <label className="mt-4 block">
          <span className="text-sm text-slate-300">Member ID</span>
          <input
            type="number"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="mt-1 block w-full rounded bg-slate-800 p-2 tabular-nums"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm text-slate-300">Position ID</span>
          <input
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            placeholder="A205"
            className="mt-1 block w-full rounded bg-slate-800 p-2 font-mono uppercase"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm text-slate-300">Reason code</span>
          <select
            value={code}
            onChange={(e) =>
              setCode(e.target.value as 'force.reverse_seniority' | 'force.cert_mandate')
            }
            className="mt-1 block w-full rounded bg-slate-800 p-2"
          >
            <option value="force.reverse_seniority">force.reverse_seniority</option>
            <option value="force.cert_mandate">force.cert_mandate</option>
          </select>
        </label>
        <label className="mt-3 block">
          <span className="text-sm text-slate-300">Reason (&gt;= 4 chars)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded bg-slate-800 p-2"
            rows={3}
          />
        </label>
        {error !== null && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-4 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded bg-red-700 px-4 py-2 hover:bg-red-600 disabled:opacity-50"
          >
            Force pick
          </button>
        </div>
      </div>
    </dialog>
  );
}
