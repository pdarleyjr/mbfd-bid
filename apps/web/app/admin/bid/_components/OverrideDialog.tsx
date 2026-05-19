'use client';
import { useState } from 'react';

interface Props {
  bidSessionId: string;
  jwt: string;
  onClose: () => void;
}

export function OverrideDialog({ bidSessionId, jwt, onClose }: Props) {
  const [memberId, setMemberId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/bid/override', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          bidSessionId,
          targetMemberId: Number(memberId),
          positionId,
          reason,
        }),
      });
      if (!res.ok) {
        setError(`Override failed (${res.status})`);
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Admin override pick"
      className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-stone-900/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="font-display text-lg font-bold text-stone-900">Override pick</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-stone-700">Member ID</span>
            <input
              data-testid="override-member-id"
              type="number"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Position ID</span>
            <input
              data-testid="override-position-id"
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Reason</span>
            <textarea
              data-testid="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="override-submit"
            disabled={submitting || !memberId || !positionId || !reason}
            onClick={submit}
            className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Force pick'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
