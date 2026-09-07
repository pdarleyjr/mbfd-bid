'use client';
import { ConfirmationDialog } from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
      <Button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="rounded border border-success/40 px-3 py-1 text-sm text-success disabled:cursor-not-allowed disabled:opacity-50"
      >
        Publish revision
      </Button>

      {open ? (
        <ConfirmationDialog
          onClose={() => setOpen(false)}
          busy={submitting}
          aria-labelledby="annual-policy-publication-heading"
        >
          <h2
            id="annual-policy-publication-heading"
            className="font-heading text-lg text-foreground"
          >
            Publication gate for annual policy
          </h2>
          <p className="mt-2 text-sm text-foreground">
            The server independently validates the draft, designated rule book, and complete member
            coverage before publication. This review does not start a Bid.
          </p>
          <Label className="mt-4 block">
            <span className="text-sm text-foreground">Publication reason (4–500 characters)</span>
            <Textarea
              required
              minLength={4}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 block w-full rounded bg-card px-3 py-2 text-foreground"
            />
          </Label>
          {error !== null ? (
            <output aria-live="polite" className="mt-2 block text-sm text-destructive">
              {error}
            </output>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded border border-border px-3 py-1 text-foreground disabled:opacity-50"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={submitting || reason.trim().length < 4}
              onClick={() => void confirmPublication()}
              className="rounded bg-destructive px-3 py-1 text-primary-foreground hover:bg-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Reviewing publication…' : 'Request server-side publication review'}
            </Button>
          </div>
        </ConfirmationDialog>
      ) : null}
    </>
  );
}
