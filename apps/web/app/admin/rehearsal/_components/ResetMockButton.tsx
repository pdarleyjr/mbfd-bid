'use client';

import { type ReactElement, useState } from 'react';

interface Props {
  sessionId: string;
}

export function ResetMockButton({ sessionId }: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            !confirm(
              `Reset mock session ${sessionId}? This wipes all bids + A-Day picks for the rehearsal.`,
            )
          ) {
            return;
          }
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(`/api/admin/rehearsal/${sessionId}/reset-mock`, {
              method: 'POST',
              credentials: 'include',
            });
            if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
            setMsg('Reset.');
          } catch (e) {
            setMsg(`Failed: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded bg-red-700 px-3 py-1 text-white text-xs disabled:opacity-50"
      >
        {busy ? 'Resetting…' : 'Reset'}
      </button>
      {msg !== null ? <output className="text-xs text-stone-700">{msg}</output> : null}
    </span>
  );
}
