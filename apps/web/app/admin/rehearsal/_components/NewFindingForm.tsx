'use client';

import { type FormEvent, type ReactElement, useState } from 'react';

interface Props {
  sessionIds: string[];
}

export function NewFindingForm({ sessionIds }: Props): ReactElement {
  const [bidSessionId, setBidSessionId] = useState<string>(sessionIds[0] ?? '');
  const [note, setNote] = useState('');
  const [screenshotR2Key, setScreenshotR2Key] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (note.trim().length === 0) {
      setMsg('Note cannot be empty.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        bidSessionId,
        note: note.trim(),
        ...(screenshotR2Key.trim().length > 0 ? { screenshotR2Key: screenshotR2Key.trim() } : {}),
      };
      const res = await fetch('/api/admin/rehearsal/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setMsg('Finding submitted.');
      setNote('');
      setScreenshotR2Key('');
    } catch (err) {
      setMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="new-finding-form"
      className="space-y-3 rounded border border-stone-300 bg-white p-4"
    >
      <h3 className="font-semibold text-stone-900">Submit Finding</h3>
      <label className="block text-sm">
        <span className="block text-stone-700">Session</span>
        <select
          value={bidSessionId}
          onChange={(e) => setBidSessionId(e.target.value)}
          className="mt-1 block w-full rounded border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-stone-900"
        >
          {sessionIds.length === 0 ? (
            <option value="">(no mock sessions)</option>
          ) : (
            sessionIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))
          )}
        </select>
      </label>
      <label className="block text-sm">
        <span className="block text-stone-700">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1 block w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 placeholder:text-stone-400"
          placeholder="What did you observe?"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-stone-700">Screenshot R2 key (optional)</span>
        <input
          type="text"
          value={screenshotR2Key}
          onChange={(e) => setScreenshotR2Key(e.target.value)}
          maxLength={500}
          className="mt-1 block w-full rounded border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-stone-900 placeholder:text-stone-400"
          placeholder="findings/2026/abc.png"
        />
      </label>
      <button
        type="submit"
        disabled={busy || sessionIds.length === 0}
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit Finding'}
      </button>
      {msg !== null ? <p className="text-sm text-stone-700">{msg}</p> : null}
    </form>
  );
}
