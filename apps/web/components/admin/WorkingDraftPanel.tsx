'use client';
import { annualGet, annualPost } from '@/app/admin/annual-plan/annual-plan-client';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

/** Private unfinished work is deliberately separate from a publishable policy. */
export function WorkingDraftPanel<T extends Record<string, unknown>>({
  draftKey,
  value,
  dirty,
  onRestore,
}: { draftKey: string; value: T; dirty: boolean; onRestore: (content: T) => void }) {
  const saved = useQuery({
    queryKey: ['working-draft', draftKey],
    queryFn: () =>
      annualGet<{ revision: number; content: T | null; updatedAt: number | null }>(
        `working-drafts/${draftKey}`,
      ),
    staleTime: 0,
  });
  const revision = useRef<number | null>(null);
  useEffect(() => {
    if (draftKey) revision.current = null;
    setMessage('');
  }, [draftKey]);
  const writing = useRef(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (saved.data && revision.current === null) revision.current = saved.data.revision;
  }, [saved.data]);
  async function store(content: T | null) {
    if (writing.current || revision.current === null)
      throw new Error('Wait for the saved draft to load before saving.');
    writing.current = true;
    setBusy(true);
    try {
      const result = await annualPost<{ revision: number }>(
        `working-drafts/${draftKey}`,
        { expected_revision: revision.current, content },
        crypto.randomUUID(),
      );
      revision.current = result.revision;
      await saved.refetch();
      setMessage(
        content
          ? 'Unfinished work saved privately. It is not an approved rule or bid setup.'
          : 'Saved editor draft cleared.',
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function save(content: T | null) {
    try {
      await store(content);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Draft could not be saved.');
    }
  }
  useEffect(() => {
    const beforeSignIn = (event: Event) => {
      if (dirty) (event as CustomEvent<Promise<unknown>[]>).detail.push(store(value));
    };
    window.addEventListener('mbfd-before-step-up', beforeSignIn);
    return () => window.removeEventListener('mbfd-before-step-up', beforeSignIn);
  });
  return (
    <aside className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || saved.isPending || saved.isError || !dirty}
          onClick={() => void save(value)}
        >
          Save unfinished work
        </Button>
        {saved.data?.content && (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                try {
                  if (saved.data?.content) onRestore(saved.data.content);
                  setMessage(
                    'Draft restored. Recheck the source and preview the changes before approval.',
                  );
                } catch {
                  setMessage(
                    'This draft cannot be restored in the current editor. Clear it and start from the saved policy.',
                  );
                }
              }}
            >
              Restore saved work
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Clear saved work
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">
          Private to your account. Saving here never approves or applies changes.
        </span>
      </div>
      {(message || saved.error) && (
        <p className="mt-2 text-sm">{message || saved.error?.message}</p>
      )}
    </aside>
  );
}
