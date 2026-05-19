'use client';

import { type ReactElement, useState } from 'react';

interface Props {
  sessionId: string;
  strategy: 'ai_top' | 'first_eligible';
  count: number;
}

export function AutoBidButton({ sessionId, strategy, count }: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const label =
    strategy === 'ai_top'
      ? `Auto-bid ${count} picks (AI)`
      : `Auto-bid ${count} picks (first-eligible)`;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(`/api/admin/rehearsal/${sessionId}/auto-bid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ count, strategy }),
            });
            if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
            const body = (await res.json()) as { picksMade: number; stoppedReason: string };
            setMsg(`Made ${body.picksMade} picks (${body.stoppedReason}).`);
          } catch (e) {
            setMsg(`Failed: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded bg-blue-700 px-3 py-1 text-white text-xs disabled:opacity-50"
      >
        {busy ? 'Running…' : label}
      </button>
      {msg !== null ? <output className="text-xs text-stone-700">{msg}</output> : null}
    </span>
  );
}
