'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ForcePickSheet } from './ForcePickSheet';

export function SessionControls({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [showForce, setShowForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function callLifecycle(path: string, body?: unknown) {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/bid-session/${sessionId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : '{}',
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setToast(`Action failed: ${errBody.error ?? res.status}`);
        return;
      }
      setToast(`OK: ${path}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => callLifecycle('start')}
          className="rounded bg-success px-3 py-2 text-primary-foreground hover:bg-success disabled:opacity-50"
        >
          Start session
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            callLifecycle('pause', {
              reason_code: 'session.pause_emergency',
              reason: 'Admin-initiated emergency pause.',
            })
          }
          className="rounded bg-warning px-3 py-2 text-primary-foreground hover:bg-warning disabled:opacity-50"
        >
          Pause
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => callLifecycle('resume', {})}
          className="rounded bg-info px-3 py-2 text-primary-foreground hover:bg-info disabled:opacity-50"
        >
          Resume
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => callLifecycle('day-start', {})}
          className="rounded border border-border px-3 py-2 text-foreground hover:border-border"
        >
          Day Start
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => setShowForce(true)}
          className="rounded border border-destructive/40 px-3 py-2 text-destructive hover:bg-destructive-surface"
        >
          Force pick
        </Button>
      </div>

      {toast !== null && (
        <output aria-live="polite" className="block text-sm text-foreground">
          {toast}
        </output>
      )}

      <ForcePickSheet
        sessionId={sessionId}
        open={showForce}
        onClose={() => setShowForce(false)}
        onDone={() => {
          setShowForce(false);
          setToast('Forced pick recorded.');
          router.refresh();
        }}
      />
    </div>
  );
}
