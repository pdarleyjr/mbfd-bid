'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <Button
      type="submit"
      disabled={pending}
      className="rounded bg-destructive px-4 py-2 text-primary-foreground disabled:opacity-50 min-h-[44px]"
    >
      {pending ? 'Uploading...' : 'Upload'}
    </Button>
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
        <Label className="flex flex-col gap-2 text-foreground">
          <span>{label}</span>
          <Input
            type="file"
            name="file"
            accept={accept}
            required
            className="rounded border border-border bg-card p-2 text-foreground"
          />
        </Label>
        {extraFields}
        <SubmitButton pending={pending} />
      </form>
      {result && <ImportResults result={result} />}
    </div>
  );
}
