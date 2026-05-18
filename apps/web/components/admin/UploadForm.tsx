'use client';

import type { ImportResult } from '@/lib/import-types';
import { useState } from 'react';
import { ImportResults } from './ImportResults';

type Props = {
  endpoint: string;
  accept: string;
  label: string;
  extraFields?: React.ReactNode;
};

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-red-700 px-4 py-2 text-white disabled:opacity-50 min-h-[44px]"
    >
      {pending ? 'Uploading...' : 'Upload'}
    </button>
  );
}

export function UploadForm({ endpoint, accept, label, extraFields }: Props) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      const data = (await res.json()) as ImportResult;
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-stone-200">
          <span>{label}</span>
          <input
            type="file"
            name="file"
            accept={accept}
            required
            className="rounded border border-stone-600 bg-slate-900 p-2 text-stone-100"
          />
        </label>
        {extraFields}
        <SubmitButton pending={pending} />
      </form>
      {result && <ImportResults result={result} />}
    </div>
  );
}
