'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { type ReactElement, useState } from 'react';

interface Props {
  sessionId: string;
}

interface CloseResponse {
  state?: string;
  idempotent?: boolean;
  error?: string;
}

/**
 * Terminates a legacy stale rehearsal while retaining its bid and audit
 * history. Canonical mock sessions remain fail-closed at the Worker boundary.
 */
export function CloseStaleMockButton({ sessionId }: Props): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const response = await fetch(
              `/api/admin/rehearsal/${encodeURIComponent(sessionId)}/close-mock`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  reason:
                    'Staging remediation: close stale legacy mock before controlled rehearsal.',
                }),
              },
            );
            const body = (await response.json().catch(() => ({}))) as CloseResponse;
            if (!response.ok || body.state !== 'complete') {
              setMessage(`Close rejected: ${body.error ?? `HTTP ${response.status}`}.`);
              return;
            }
            setMessage(
              body.idempotent
                ? 'Mock was already closed.'
                : 'Stale mock closed; audit history retained.',
            );
            router.refresh();
          } catch (error) {
            setMessage(`Close request failed: ${(error as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded bg-warning px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Closing…' : 'Close stale mock'}
      </Button>
      {message !== null ? <output className="text-xs text-foreground">{message}</output> : null}
    </span>
  );
}
