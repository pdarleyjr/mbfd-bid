'use client';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';

interface Props {
  bidSessionId: string;
  onClose: () => void;
}

export function OverrideDialog({ bidSessionId, onClose }: Props) {
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
    <ConfirmationDialog onClose={onClose} busy={submitting} aria-label="Admin override pick">
      <div className="w-full">
        <h3 className="font-heading text-lg font-bold text-foreground">Override pick</h3>
        <div className="mt-4 space-y-3">
          <Label className="block text-sm">
            <span className="text-foreground">Member ID</span>
            <Input
              data-testid="override-member-id"
              type="number"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
            />
          </Label>
          <Label className="block text-sm">
            <span className="text-foreground">Position ID</span>
            <Input
              data-testid="override-position-id"
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
              className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
            />
          </Label>
          <Label className="block text-sm">
            <span className="text-foreground">Reason</span>
            <Textarea
              data-testid="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
            />
          </Label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
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
            data-testid="override-submit"
            disabled={submitting || !memberId || !positionId || !reason}
            onClick={submit}
            className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Force pick'}
          </Button>
        </div>
      </div>
    </ConfirmationDialog>
  );
}
