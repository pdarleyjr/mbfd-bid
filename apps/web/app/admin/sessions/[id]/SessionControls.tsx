'use client';

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
        <button
          type="button"
          disabled={busy}
          onClick={() => callLifecycle('start')}
          className="rounded bg-emerald-700 px-3 py-2 text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Start session
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            callLifecycle('pause', {
              reason_code: 'session.pause_emergency',
              reason: 'Admin-initiated emergency pause.',
            })
          }
          className="rounded bg-amber-700 px-3 py-2 text-white hover:bg-amber-600 disabled:opacity-50"
        >
          Pause
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => callLifecycle('resume', {})}
          className="rounded bg-sky-700 px-3 py-2 text-white hover:bg-sky-600 disabled:opacity-50"
        >
          Resume
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => callLifecycle('day-start', {})}
          className="rounded border border-slate-600 px-3 py-2 text-slate-200 hover:border-slate-400"
        >
          Day Start
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowForce(true)}
          className="rounded border border-red-500 px-3 py-2 text-red-300 hover:bg-red-500/10"
        >
          Force pick
        </button>
      </div>

      {toast !== null && (
        <output aria-live="polite" className="block text-sm text-slate-300">
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
