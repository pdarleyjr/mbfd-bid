'use client';

import { type ReactElement, useState } from 'react';

interface Props {
  kind: 'roster' | 'audit-csv';
  shift?: 'A' | 'B' | 'C' | 'D';
  sessionId: string;
}

export function ExportTriggerButton({ kind, shift, sessionId }: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const label =
    kind === 'roster' ? `Generate ${shift ?? '?'} Shift Roster` : 'Generate Full Audit CSV';
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const path =
              kind === 'roster'
                ? `/api/admin/exports/roster/${shift}`
                : '/api/admin/exports/audit-csv';
            const r = await fetch(path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId }),
              credentials: 'include',
            });
            if (!r.ok) throw new Error(await r.text());
            setMsg(kind === 'roster' ? `${shift} Shift roster generated.` : 'Audit CSV generated.');
          } catch (e) {
            setMsg(`Failed: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Generating…' : label}
      </button>
      {msg ? <output>{msg}</output> : null}
    </div>
  );
}
