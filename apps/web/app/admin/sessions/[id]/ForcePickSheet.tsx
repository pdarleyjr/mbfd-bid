'use client';
import { ConfirmationDialog } from '@/components/ui/dialog';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';

export function ForcePickSheet({
  sessionId,
  open,
  onClose,
  onDone,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [code, setCode] = useState<'force.reverse_seniority' | 'force.cert_mandate'>(
    'force.reverse_seniority',
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (memberId === '' || positionId === '' || reason.trim().length < 4) {
      setError('Member ID, Position ID, and reason (>=4 chars) are all required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          member_id: Number(memberId),
          position_id: positionId.toUpperCase(),
          reason_code: code,
          reason,
        }),
      });
      if (res.status === 201) {
        onDone();
        return;
      }
      if (res.status === 401) {
        setError('Step-up auth required. Re-authenticate from the controls panel.');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(`Force-pick failed: ${body.error ?? res.status}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmationDialog onClose={onClose} busy={busy} aria-labelledby="force-title">
      <div className="w-full">
        <h2 id="force-title" className="font-heading text-lg">
          Force pick
        </h2>
        <p className="mt-2 text-sm text-foreground">
          Eligibility is BYPASSED. The bid is recorded with forced=true and your admin id.
        </p>
        <Label className="mt-4 block">
          <span className="text-sm text-foreground">Member ID</span>
          <Input
            type="number"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="mt-1 block w-full rounded bg-card p-2 tabular-nums"
          />
        </Label>
        <Label className="mt-3 block">
          <span className="text-sm text-foreground">Position ID</span>
          <Input
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            placeholder="A205"
            className="mt-1 block w-full rounded bg-card p-2 font-mono uppercase"
          />
        </Label>
        <Label className="mt-3 block">
          <span className="text-sm text-foreground">Reason code</span>
          <NativeSelect
            value={code}
            onChange={(e) =>
              setCode(e.target.value as 'force.reverse_seniority' | 'force.cert_mandate')
            }
            className="mt-1 block w-full rounded bg-card p-2"
          >
            <option value="force.reverse_seniority">force.reverse_seniority</option>
            <option value="force.cert_mandate">force.cert_mandate</option>
          </NativeSelect>
        </Label>
        <Label className="mt-3 block">
          <span className="text-sm text-foreground">Reason (&gt;= 4 chars)</span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded bg-card p-2"
            rows={3}
          />
        </Label>
        {error !== null && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-4 py-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={submit}
            variant="destructive"
            className="rounded px-4 py-2 disabled:opacity-50"
          >
            Force pick
          </Button>
        </div>
      </div>
    </ConfirmationDialog>
  );
}
