'use client';

import { type FormEvent, useState } from 'react';

interface Props {
  bidSessionId: string;
  expectedSeq: number;
}

function errorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return body.error;
  }
  return fallback;
}

/**
 * Mock sessions have their own rehearsal-only freeze command. Keeping it in a
 * separate component prevents a mock board from accidentally presenting the
 * live command endpoint as an available action.
 */
export function MockFreezeButton({ bidSessionId, expectedSeq }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/admin/rehearsal/${encodeURIComponent(bidSessionId)}/commands/freeze`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          credentials: 'include',
          body: JSON.stringify({ expectedSeq, reason: reason.trim() }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(body, `Rehearsal freeze failed (${response.status}).`));
        return;
      }
      setOpen(false);
      setReason('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rehearsal freeze failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="mock-freeze-action"
        onClick={() => setOpen(true)}
        className="rounded border border-amber-600 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
      >
        Freeze rehearsal
      </button>

      {open && (
        <dialog
          open
          aria-modal="true"
          aria-label="Freeze mock rehearsal"
          className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-stone-900/40 p-4"
        >
          <form className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onSubmit={submit}>
            <h2 className="font-display text-lg font-bold text-amber-900">Freeze rehearsal</h2>
            <p className="mt-2 text-sm text-stone-700">
              This sends an idempotent rehearsal-only freeze command at sequence {expectedSeq}. It
              does not call live bid controls.
            </p>
            <label className="mt-4 block text-sm">
              <span className="text-stone-700">Reason (min 4 characters)</span>
              <textarea
                required
                minLength={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className="mt-1 block w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            {error !== null && (
              <output aria-live="polite" className="mt-2 block text-sm text-red-700">
                {error}
              </output>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || reason.trim().length < 4}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting ? 'Freezing…' : 'Freeze rehearsal'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
