'use client';
import { useState } from 'react';

/** A refresh may reveal newer evidence; only a separate explicit action adopts
 * its revision. Callers key this component by the identity being edited. */
export function RetainedEvidenceReview<T>({
  disabled,
  load,
  useRevision,
}: {
  disabled: boolean;
  load(): Promise<{ value: T; label: string }>;
  useRevision(value: T): void;
}) {
  const [review, setReview] = useState<{ value: T; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const button =
    'min-h-11 rounded border border-slate-500 px-4 py-2 text-sm font-semibold disabled:opacity-50';
  return (
    <section className="space-y-3 rounded border border-slate-600 p-4">
      <button
        type="button"
        disabled={disabled || busy}
        className={button}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          setReview(null);
          try {
            setReview(await load());
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Latest evidence unavailable');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Refreshing history…' : 'Refresh history and retain edits'}
      </button>
      {review && (
        <div className="space-y-2 text-sm">
          <p>
            {review.label}. Read the refreshed evidence history before applying your retained edits
            to this revision.
          </p>
          <button
            type="button"
            disabled={disabled || busy}
            className={button}
            onClick={() => {
              useRevision(review.value);
              setReview(null);
              setMessage(
                'Retained edits now use the reviewed evidence revision. Submit when your proposal is ready.',
              );
            }}
          >
            Use reviewed evidence revision
          </button>
        </div>
      )}
      {message && <output className="block text-sm">{message}</output>}
    </section>
  );
}
