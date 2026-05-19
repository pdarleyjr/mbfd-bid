'use client';
import { useState } from 'react';
import { FreezeConfirmDialog } from './FreezeConfirmDialog';
import { OverrideDialog } from './OverrideDialog';

interface Props {
  bidSessionId: string;
  jwt: string;
}

export function AdminActionsBar({ bidSessionId, jwt }: Props) {
  const [open, setOpen] = useState<'override' | 'freeze' | null>(null);
  return (
    <section className="flex flex-wrap gap-2 border-b border-stone-200 bg-white px-6 py-3">
      <button
        type="button"
        data-testid="admin-action-skip"
        className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100"
        onClick={async () => {
          const reason = prompt('Skip reason?');
          if (!reason) return;
          await fetch('/api/admin/bid/skip', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
              'Idempotency-Key': crypto.randomUUID(),
            },
            body: JSON.stringify({ bidSessionId, reason }),
          });
        }}
      >
        Skip
      </button>
      <button
        type="button"
        data-testid="admin-action-override"
        className="rounded border border-red-700 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100"
        onClick={() => setOpen('override')}
      >
        Override
      </button>
      <button
        type="button"
        data-testid="admin-action-freeze"
        className="rounded border border-amber-600 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
        onClick={() => setOpen('freeze')}
      >
        Freeze
      </button>
      {open === 'override' ? (
        <OverrideDialog bidSessionId={bidSessionId} jwt={jwt} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'freeze' ? (
        <FreezeConfirmDialog bidSessionId={bidSessionId} jwt={jwt} onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}
