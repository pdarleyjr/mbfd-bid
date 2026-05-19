'use client';

import { type ReactElement, useState } from 'react';

export function ManualRetryButton({ bidId }: { bidId: string }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={busy || done}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch(`/api/admin/portal-retry/${encodeURIComponent(bidId)}`, {
            method: 'POST',
            credentials: 'include',
          });
          setDone(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {done ? 'Queued' : busy ? 'Retrying…' : 'Retry'}
    </button>
  );
}
