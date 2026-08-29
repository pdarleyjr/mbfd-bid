'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export interface RuleBookCreateSource {
  version: string;
  effectiveYear: number;
  status: 'draft' | 'active' | 'archived';
}

interface RuleBookCreateFormProps {
  ruleBooks: RuleBookCreateSource[];
}

export function RuleBookCreateForm({ ruleBooks }: RuleBookCreateFormProps) {
  const router = useRouter();
  const [effectiveYear, setEffectiveYear] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRuleBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const year = Number(effectiveYear);
    const trimmedReason = reason.trim();
    if (!Number.isInteger(year) || year < 2024 || year > 2100) {
      setError('Enter an effective year from 2024 through 2100.');
      return;
    }
    if (trimmedReason.length < 4 || trimmedReason.length > 500) {
      setError('Provide a reason between 4 and 500 characters.');
      return;
    }

    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      effective_year: year,
      reason: trimmedReason,
    };
    if (cloneFrom.length > 0) payload.clone_from = cloneFrom;
    if (notes.trim().length > 0) payload.notes = notes.trim();

    try {
      const response = await fetch('/api/admin/rule-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body !== null && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : `The draft could not be created (${response.status}).`;
        setError(detail);
        return;
      }
      const version =
        body !== null && typeof body === 'object' && 'version' in body
          ? (body as { version: unknown }).version
          : null;
      if (typeof version !== 'string' || version.length === 0) {
        setError('The draft was created, but its version was not returned. Refresh this page.');
        return;
      }
      router.push(`/admin/rule-books/${encodeURIComponent(version)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The draft could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-6 border-y border-slate-700 py-6"
      aria-labelledby="rule-book-create-heading"
    >
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
          Draft workflow
        </p>
        <h2 id="rule-book-create-heading" className="mt-1 font-heading text-xl text-white">
          Create draft rule book
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Start a fresh policy draft or clone an existing book for review. Creation never publishes
          a rule book.
        </p>
      </div>

      <form
        onSubmit={createRuleBook}
        data-testid="rule-book-create-form"
        className="mt-5 grid max-w-3xl gap-4 md:grid-cols-2"
      >
        <label className="block">
          <span className="text-sm font-medium text-slate-100">Effective year</span>
          <input
            required
            type="number"
            min={2024}
            max={2100}
            step={1}
            inputMode="numeric"
            value={effectiveYear}
            onChange={(event) => setEffectiveYear(event.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-100">Clone source</span>
          <select
            value={cloneFrom}
            onChange={(event) => setCloneFrom(event.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-white"
          >
            <option value="">Start without cloning</option>
            {ruleBooks.map((ruleBook) => (
              <option key={ruleBook.version} value={ruleBook.version}>
                {ruleBook.version} — {ruleBook.effectiveYear} ({ruleBook.status})
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="text-sm font-medium text-slate-100">Notes (optional)</span>
          <textarea
            maxLength={2000}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white"
            placeholder="Scope or review context for this draft."
          />
        </label>

        <label className="block md:col-span-2">
          <span className="text-sm font-medium text-slate-100">Reason for this change</span>
          <textarea
            required
            minLength={4}
            maxLength={500}
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white"
            placeholder="Record the reviewed operational reason for creating this draft."
          />
          <span className="mt-1 block text-xs text-slate-400">Required · 4–500 characters</span>
        </label>

        <div className="md:col-span-2">
          {error !== null && (
            <output aria-live="polite" className="block text-sm text-red-300">
              {error}
            </output>
          )}
          <button
            type="submit"
            disabled={busy || effectiveYear.length === 0 || reason.trim().length < 4}
            className="mt-2 min-h-11 rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Creating draft…' : 'Create reviewed draft'}
          </button>
        </div>
      </form>
    </section>
  );
}
