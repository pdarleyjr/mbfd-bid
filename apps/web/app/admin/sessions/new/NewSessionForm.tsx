'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export function NewSessionForm() {
  const router = useRouter();
  const [bidYear, setBidYear] = useState(new Date().getFullYear());
  const [days, setDays] = useState(2);
  const [timer, setTimer] = useState(180);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
          expected_duration_days: days,
          turn_timer_seconds: timer,
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
      <label className="block">
        <span className="text-sm text-slate-300">Expected duration (days)</span>
        <input
          type="number"
          min={1}
          max={7}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
        />
      </label>
      <label className="block">
        <span className="text-sm text-slate-300">Turn timer (seconds)</span>
        <input
          type="number"
          min={30}
          max={600}
          value={timer}
          onChange={(e) => setTimer(Number(e.target.value))}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
        />
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
