'use client';

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
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-slate-700 bg-slate-800 p-6"
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-400">Current PIN</div>
        <div
          data-testid="current-bid-pin"
          className="font-mono text-2xl tabular-nums text-slate-50"
        >
          {current?.configured ? current.pin : 'Not configured'}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {current?.configured
            ? `Last changed ${current.updatedAt ?? '—'} by ${current.updatedBy ?? 'unknown'}.`
            : 'No active PIN is configured. Enter a new PIN to initialize access.'}
        </div>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-slate-200">New PIN</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{4,8}"
          minLength={4}
          maxLength={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="mt-1 block w-40 rounded-lg border border-slate-600 bg-slate-900 px-3 py-3 font-mono text-lg tracking-widest text-slate-50 shadow-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500"
          data-testid="bid-pin-input"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={
            mutation.isPending ||
            draft.length < 4 ||
            (current?.configured === true && draft === current.pin)
          }
          data-testid="save-bid-pin"
          className="inline-flex items-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Save PIN'}
        </button>
      </div>

      {statusMsg && (
        <output
          data-testid="bid-pin-status"
          className={
            statusMsg.startsWith('Save failed')
              ? 'text-sm text-red-400'
              : 'text-sm text-emerald-400'
          }
        >
          {statusMsg}
        </output>
      )}
    </form>
  );
}
