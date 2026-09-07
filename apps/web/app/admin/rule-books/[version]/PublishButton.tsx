'use client';
import { ConfirmationDialog } from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-destructive px-4 py-2 text-primary-foreground hover:bg-destructive"
      >
        Review publication gate
      </Button>

      {open && (
        <ConfirmationDialog
          onClose={() => setOpen(false)}
          busy={submitting}
          aria-label="Publish rule book"
        >
          <h2 className="font-heading text-lg text-foreground">
            Publication gate for rule book {version}
          </h2>
          <p className="mt-2 text-sm text-foreground">
            This request does not guarantee publication. The server independently checks draft
            validation and designated annual-configuration state. This UI neither authorizes nor
            proves a promotion.
          </p>
          <Label className="mt-4 block">
            <span className="text-sm text-foreground">Reason (min 4 chars)</span>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block w-full rounded bg-card px-3 py-2 text-foreground"
              rows={3}
            />
          </Label>
          {error !== null && (
            <output aria-live="polite" className="mt-2 text-sm text-destructive">
              {error}
            </output>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-border px-3 py-1 text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={publish}
              disabled={submitting || reason.trim().length < 4}
              className="rounded bg-destructive px-3 py-1 text-primary-foreground hover:bg-destructive disabled:opacity-50"
            >
              Request server-side publication review
            </Button>
          </div>
        </ConfirmationDialog>
      )}
    </div>
  );
}
