'use client';

import { useState } from 'react';

interface Props {
  busy: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
}

export function AnnualPolicyPublishGate({ busy, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmPublication() {
    setSubmitting(true);
    setError(null);
    try {
      const published = await onConfirm(reason.trim());
      if (published) {
        setOpen(false);
        setReason('');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Publication review failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="rounded border border-emerald-700 px-3 py-1 text-sm text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Publish revision
      </button>

      {open ? (
        <dialog
          open
          aria-labelledby="annual-policy-publication-heading"
          className="fixed inset-0 m-auto w-full max-w-md rounded border border-slate-700 bg-slate-900 p-6 text-slate-200"
        >
          <h2 id="annual-policy-publication-heading" className="font-heading text-lg text-white">
            Publication gate for annual policy
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            The server independently validates the draft, designated rule book, and complete member
            coverage before publication. This review does not start a Bid.
          </p>
          <label className="mt-4 block">
            <span className="text-sm text-slate-300">Publication reason (4–500 characters)</span>
            <textarea
              required
              minLength={4}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          {error !== null ? (
            <output aria-live="polite" className="mt-2 block text-sm text-red-300">
              {error}
            </output>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded border border-slate-600 px-3 py-1 text-slate-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || reason.trim().length < 4}
              onClick={() => void confirmPublication()}
              className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Reviewing publication…' : 'Request server-side publication review'}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
