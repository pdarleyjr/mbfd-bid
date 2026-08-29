'use client';
import { useState } from 'react';

interface Props {
  bidSessionId: string;
  onClose: () => void;
}

export function FreezeConfirmDialog({ bidSessionId, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/bid/freeze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ bidSessionId, reason }),
      });
      if (!res.ok) {
        setError(`Freeze failed (${res.status})`);
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
      aria-label="Freeze live bid session"
      className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-stone-900/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="font-display text-lg font-bold text-amber-900">Freeze session</h3>
        <p className="mt-2 text-sm text-stone-700">
          One-way operation. Freezing stops all member picks until an admin resumes the session.
        </p>
        <div className="mt-4">
          <label className="block text-sm">
            <span className="text-stone-700">Reason</span>
            <textarea
              data-testid="freeze-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
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
            data-testid="freeze-submit"
            disabled={submitting || !reason}
            onClick={submit}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? 'Freezing…' : 'Freeze session'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
