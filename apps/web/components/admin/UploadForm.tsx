'use client';

import type { ImportResult } from '@/app/admin/members/import/actions';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ImportResults } from './ImportResults';

type Props = {
  action: (fd: FormData) => Promise<ImportResult>;
  accept: string;
  label: string;
  extraFields?: React.ReactNode;
};

function SubmitButton() {
  const { pending } = useFormStatus();
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

export function UploadForm({ action, accept, label, extraFields }: Props) {
  const [result, setResult] = useState<ImportResult | null>(null);

  async function clientAction(fd: FormData) {
    setResult(null);
    const r = await action(fd);
    setResult(r);
  }

  return (
    <div>
      <form action={clientAction} className="flex flex-col gap-4">
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
        <SubmitButton />
      </form>
      {result && <ImportResults result={result} />}
    </div>
  );
}
