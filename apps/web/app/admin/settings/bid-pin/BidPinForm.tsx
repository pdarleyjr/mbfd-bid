'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface ConfiguredPinSetting {
  configured: true;
  pin: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface UnconfiguredPinSetting {
  configured: false;
  state: 'missing' | 'malformed' | 'unavailable';
}

type PinSetting = ConfiguredPinSetting | UnconfiguredPinSetting;

interface Props {
  initial: PinSetting;
}

const PIN_RE = /^\d{4,8}$/;

export function BidPinForm({ initial }: Props) {
  const [draft, setDraft] = useState(initial.configured ? initial.pin : '');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Re-read on a 15s cadence so concurrent edits from the MBFD Hub admin
  // surface within seconds — the user explicitly wanted bidirectional sync.
  const { data: current } = useQuery<PinSetting>({
    queryKey: ['bid-pin-setting'],
    queryFn: async () => {
      const r = await fetch('/api/admin/settings/bid-pin', {
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      return r.json() as Promise<PinSetting>;
    },
    initialData: initial,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation<ConfiguredPinSetting, Error, string>({
    mutationFn: async (pin) => {
      const r = await fetch('/api/admin/settings/bid-pin', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `http_${r.status}`);
      }
      return r.json() as Promise<ConfiguredPinSetting>;
    },
    onSuccess: (setting) => {
      queryClient.setQueryData<PinSetting>(['bid-pin-setting'], setting);
      setDraft(setting.pin);
      setStatusMsg(`Saved at ${setting.updatedAt ?? 'now'}.`);
    },
    onError: (err) => {
      setStatusMsg(`Save failed: ${err.message}.`);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    if (!PIN_RE.test(draft)) {
      setStatusMsg('PIN must be 4–8 digits.');
      return;
    }
    mutation.mutate(draft);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Current PIN</div>
        <div
          data-testid="current-bid-pin"
          className="font-mono text-2xl tabular-nums text-foreground"
        >
          {current?.configured ? current.pin : 'Not configured'}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {current?.configured
            ? `Last changed ${current.updatedAt ?? '—'} by ${current.updatedBy ?? 'unknown'}.`
            : 'No active PIN is configured. Enter a new PIN to initialize access.'}
        </div>
      </div>

      <Label className="block">
        <span className="block text-sm font-medium text-foreground">New PIN</span>
        <Input
          type="text"
          inputMode="numeric"
          pattern="\d{4,8}"
          minLength={4}
          maxLength={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="mt-1 block w-40 rounded-lg border border-border bg-card px-3 py-3 font-mono text-lg tracking-widest text-foreground shadow-sm outline-none focus:border-destructive/40 focus:ring-2 focus:ring-ring"
          data-testid="bid-pin-input"
        />
      </Label>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={
            mutation.isPending ||
            draft.length < 4 ||
            (current?.configured === true && draft === current.pin)
          }
          data-testid="save-bid-pin"
          className="inline-flex items-center rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Save PIN'}
        </Button>
      </div>

      {statusMsg && (
        <output
          data-testid="bid-pin-status"
          className={
            statusMsg.startsWith('Save failed')
              ? 'text-sm text-destructive'
              : 'text-sm text-success'
          }
        >
          {statusMsg}
        </output>
      )}
    </form>
  );
}
