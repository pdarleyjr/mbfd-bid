'use client';

import { type ReactElement, useState } from 'react';

interface Props {
  sessionId: string;
}

export function VerifyAuditButton({ sessionId }: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(
              `/api/admin/audit/verify-chain?session_id=${encodeURIComponent(sessionId)}`,
              { method: 'GET', credentials: 'include' },
            );
            if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
            const body = (await res.json()) as { ok: boolean; checkedChunks?: number };
            setMsg(body.ok ? `Chain OK (${body.checkedChunks ?? 0} chunks)` : 'Chain BROKEN');
          } catch (e) {
            setMsg(`Failed: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded bg-stone-700 px-3 py-1 text-white text-xs disabled:opacity-50"
      >
        {busy ? 'Verifying…' : 'Verify Audit Chain'}
      </button>
      {msg !== null ? <output className="text-xs text-stone-700">{msg}</output> : null}
    </span>
  );
}
