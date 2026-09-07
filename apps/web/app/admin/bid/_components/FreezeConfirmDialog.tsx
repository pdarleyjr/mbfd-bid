'use client';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
    <ConfirmationDialog onClose={onClose} busy={submitting} aria-label="Freeze live bid session">
      <div className="w-full">
        <h3 className="font-heading text-lg font-bold text-amber-900">Freeze session</h3>
        <p className="mt-2 text-sm text-foreground">
          One-way operation. Freezing stops all member picks until an admin resumes the session.
        </p>
        <div className="mt-4">
          <Label className="block text-sm">
            <span className="text-foreground">Reason</span>
            <Textarea
              data-testid="freeze-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
            />
          </Label>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            onClick={onClose}
            className="rounded border border-border bg-white px-3 py-1.5 text-sm hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="freeze-submit"
            disabled={submitting || !reason}
            onClick={submit}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? 'Freezing…' : 'Freeze session'}
          </Button>
        </div>
      </div>
    </ConfirmationDialog>
  );
}
