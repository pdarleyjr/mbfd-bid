'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function PublishButton({ version }: { version: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function publish() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rule-books/${version}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      });
      if (res.status === 401) {
        const body = (await res.json()) as { error: string };
        if (body.error === 'step_up_required') {
          setError('Session is stale — please re-authenticate (pending step-up dialog).');
          return;
        }
        setError('Auth failed.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Publish failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600"
      >
        Review publication gate
      </button>

      {open && (
        <dialog
          open
          className="fixed inset-0 m-auto w-full max-w-md rounded border border-slate-700 bg-slate-900 p-6 text-slate-200"
        >
          <h2 className="font-heading text-lg text-white">
            Publication gate for rule book {version}
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            This request does not guarantee publication. The server independently checks draft
            validation and designated annual-configuration state. This UI neither authorizes nor
            proves a promotion.
          </p>
          <label className="mt-4 block">
            <span className="text-sm text-slate-300">Reason (min 4 chars)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-white"
              rows={3}
            />
          </label>
          {error !== null && (
            <output aria-live="polite" className="mt-2 text-sm text-red-400">
              {error}
            </output>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-slate-600 px-3 py-1 text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={submitting || reason.trim().length < 4}
              className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-600 disabled:opacity-50"
            >
              Request server-side publication review
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
