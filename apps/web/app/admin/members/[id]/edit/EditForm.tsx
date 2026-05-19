'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft } from '../../../../../lib/draft-storage';

type Rank = 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
type BidCategory = 'OFC' | 'FF' | 'EXCLUDED';

interface Member {
  id: number;
  rank: Rank;
  bidCategory: BidCategory;
  rscSeniority: number;
  isProbationary: boolean;
}

interface FormValues {
  rank: Rank;
  bid_category: BidCategory;
  rsc_seniority: number;
  is_probationary: boolean;
}

const routeFor = (id: number): string => `/admin/members/${id}/edit`;

export function EditForm({ member }: { member: Member }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    rank: member.rank,
    bid_category: member.bidCategory,
    rsc_seniority: member.rscSeniority,
    is_probationary: member.isProbationary,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftBanner, setDraftBanner] = useState<{ savedAt: string } | null>(null);

  // Detect saved draft on mount.
  useEffect(() => {
    const d = loadDraft<FormValues>(routeFor(member.id), 'member');
    if (d !== null) setDraftBanner({ savedAt: d.savedAt });
  }, [member.id]);

  // Autosave on change (debounced 500ms).
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft(routeFor(member.id), 'member', values);
    }, 500);
    return () => clearTimeout(t);
  }, [values, member.id]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
        credentials: 'include',
      });
      if (res.ok) {
        deleteDraft(routeFor(member.id), 'member');
        setToast('Saved');
        router.refresh();
      } else if (res.status === 401) {
        setToast('Session expired — please log in again.');
      } else {
        setToast(`Save failed (${res.status})`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {draftBanner !== null && (
        <div className="rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
          Restore unsaved changes from {new Date(draftBanner.savedAt).toLocaleString()}?
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => {
              const d = loadDraft<FormValues>(routeFor(member.id), 'member');
              if (d !== null) setValues(d.values);
              setDraftBanner(null);
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => {
              deleteDraft(routeFor(member.id), 'member');
              setDraftBanner(null);
            }}
          >
            Discard
          </button>
        </div>
      )}

      <label className="block">
        <span className="text-sm text-slate-300">Rank</span>
        <select
          value={values.rank}
          onChange={(e) => setValues((v) => ({ ...v, rank: e.target.value as Rank }))}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-white"
        >
          {(['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF'] as const).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm text-slate-300">Bid category</span>
        <select
          value={values.bid_category}
          onChange={(e) =>
            setValues((v) => ({ ...v, bid_category: e.target.value as BidCategory }))
          }
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 text-white"
        >
          {(['OFC', 'FF', 'EXCLUDED'] as const).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm text-slate-300">RSC seniority</span>
        <input
          type="number"
          value={values.rsc_seniority}
          onChange={(e) => setValues((v) => ({ ...v, rsc_seniority: Number(e.target.value) }))}
          className="mt-1 block w-full rounded bg-slate-800 px-3 py-2 tabular-nums text-white"
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={values.is_probationary}
          onChange={(e) => setValues((v) => ({ ...v, is_probationary: e.target.checked }))}
        />
        <span className="text-sm text-slate-300">Probationary</span>
      </label>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-slate-600 px-4 py-2 text-slate-200 hover:border-slate-400"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {toast !== null && (
        <output aria-live="polite" className="text-sm text-emerald-400">
          {toast}
        </output>
      )}
    </form>
  );
}
