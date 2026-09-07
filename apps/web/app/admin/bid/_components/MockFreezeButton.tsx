'use client';
import { ConfirmationDialog } from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
      <Button
        type="button"
        data-testid="mock-freeze-action"
        onClick={() => setOpen(true)}
        className="rounded border border-amber-600 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
      >
        Freeze rehearsal
      </Button>

      {open && (
        <ConfirmationDialog
          onClose={() => setOpen(false)}
          busy={submitting}
          aria-label="Freeze mock rehearsal"
        >
          <form className="w-full" onSubmit={submit}>
            <h2 className="font-heading text-lg font-bold text-amber-900">Freeze rehearsal</h2>
            <p className="mt-2 text-sm text-foreground">
              This sends an idempotent rehearsal-only freeze command at sequence {expectedSeq}. It
              does not call live bid controls.
            </p>
            <Label className="mt-4 block text-sm">
              <span className="text-foreground">Reason (min 4 characters)</span>
              <Textarea
                required
                minLength={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className="mt-1 block w-full rounded border border-border px-2 py-1.5 text-sm"
              />
            </Label>
            {error !== null && (
              <output aria-live="polite" className="mt-2 block text-sm text-red-700">
                {error}
              </output>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-border bg-white px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || reason.trim().length < 4}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting ? 'Freezing…' : 'Freeze rehearsal'}
              </Button>
            </div>
          </form>
        </ConfirmationDialog>
      )}
    </>
  );
}
