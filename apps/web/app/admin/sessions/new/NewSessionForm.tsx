'use client';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

interface LiveReadinessPreview {
  dry_run?: boolean;
  would_allow_start?: boolean;
  error?: string;
}

export function NewSessionForm({ defaultMock = true }: { defaultMock?: boolean }) {
  const router = useRouter();
  const [bidYear, setBidYear] = useState(new Date().getFullYear());
  const [isMock, setIsMock] = useState(defaultMock);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewingReadiness, setPreviewingReadiness] = useState(false);
  const [readinessPreview, setReadinessPreview] = useState<LiveReadinessPreview | null>(null);

  async function previewLiveReadiness() {
    setPreviewingReadiness(true);
    setReadinessPreview(null);
    try {
      const csrfFetch = createCsrfAwareFetch(fetch, () => window.location.origin);
      const response = await csrfFetch('/api/admin/bid-session/readiness-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bid_year: bidYear }),
      });
      const body = (await response.json().catch(() => ({}))) as LiveReadinessPreview;
      setReadinessPreview(
        response.ok && body.dry_run === true
          ? body
          : {
              dry_run: true,
              would_allow_start: false,
              error: body.error ?? `HTTP ${response.status}`,
            },
      );
    } finally {
      setPreviewingReadiness(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/bid-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bid_year: bidYear,
          // The Worker deliberately rejects omission: a UI default must not
          // be able to turn into a real session through an API default.
          mode: isMock ? 'mock' : 'live',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Create failed (${res.status})`);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/admin/sessions/${id}` as never);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm text-slate-300">Bid year</span>
        <input
          type="number"
          value={bidYear}
          onChange={(e) => setBidYear(Number(e.target.value))}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
        />
      </label>
      <p className="rounded border border-slate-700 bg-slate-800/60 px-3 py-3 text-sm text-slate-300">
        Duration and turn-timer settings are taken from the designated annual configuration. They
        cannot be overridden per session.
      </p>
      <p className="rounded border border-blue-800 bg-blue-950/40 px-3 py-3 text-sm text-blue-100">
        Rehearsal/mock is selected by default. Clear it only when you deliberately need the
        separately guarded live-mode request; the server remains the authority for live readiness.
      </p>
      <div className="rounded border border-slate-700 bg-slate-800/60 p-3">
        <p className="text-sm text-slate-300">
          This read-only dry run creates no session, order, audit event, or other runtime state.
        </p>
        <button
          type="button"
          data-testid="live-readiness-preview"
          disabled={previewingReadiness}
          onClick={() => void previewLiveReadiness()}
          className="mt-3 rounded border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-100 disabled:opacity-50"
        >
          {previewingReadiness ? 'Checking live readiness…' : 'Run live-readiness dry run'}
        </button>
        {readinessPreview !== null ? (
          <output className="mt-3 block text-sm text-slate-200">
            Live readiness dry run:{' '}
            {readinessPreview.would_allow_start ? 'would allow start' : 'blocked'}
            {readinessPreview.error ? ` (${readinessPreview.error})` : ''}.
          </output>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={isMock}
          onChange={(e) => setIsMock(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-700"
        />
        Create as rehearsal/mock session (clear only to request live mode)
      </label>

      {error !== null && (
        <output aria-live="polite" className="block text-sm text-red-400">
          {error}
        </output>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
      >
        Create session
      </button>
    </form>
  );
}
