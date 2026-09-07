'use client';

import { Button } from '@/components/ui/button';
import { type ReactElement, useState } from 'react';

export function ManualRetryButton({ bidId }: { bidId: string }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        disabled={busy || done}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch(`/api/admin/portal-retry/${encodeURIComponent(bidId)}`, {
              method: 'POST',
              credentials: 'include',
            });
            if (!response.ok) {
              setError(`Retry failed (${response.status}). The retry was not queued.`);
              return;
            }
            setDone(true);
          } catch {
            setError('Retry could not be requested. The retry was not queued.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {done ? 'Queued' : busy ? 'Retrying…' : 'Retry'}
      </Button>
      {error !== null && (
        <output role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </output>
      )}
    </div>
  );
}
