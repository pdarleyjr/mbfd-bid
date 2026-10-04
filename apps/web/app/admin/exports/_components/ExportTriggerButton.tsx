'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { type ReactElement, useState } from 'react';

interface Props {
  kind: 'roster' | 'audit-csv';
  shift?: 'A' | 'B' | 'C' | 'D';
  sessionId: string;
}

export function ExportTriggerButton({ kind, shift, sessionId }: Props): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const label =
    kind === 'roster'
      ? `Archive ${shift === 'D' ? 'Days' : `${shift ?? '?'} Shift`} PDF`
      : 'Archive Full Audit CSV';
  return (
    <div>
      <Button
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
            if (!r.ok) throw new Error(`The report could not be created (${r.status}). Try again.`);
            setMsg(kind === 'roster' ? `${shift} Shift roster generated.` : 'Audit CSV generated.');
            router.refresh();
          } catch (e) {
            setMsg(`Failed: ${(e as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Generating…' : label}
      </Button>
      {msg ? (
        <p role={msg.startsWith('Failed:') ? 'alert' : 'status'} className="mt-2 text-sm">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
