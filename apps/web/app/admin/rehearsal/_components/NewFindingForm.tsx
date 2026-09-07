'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
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
      className="space-y-3 rounded border border-border bg-card p-4"
    >
      <h3 className="font-semibold text-foreground">Submit Finding</h3>
      <Label className="block text-sm">
        <span className="block text-foreground">Session</span>
        <NativeSelect
          value={bidSessionId}
          onChange={(e) => setBidSessionId(e.target.value)}
          className="mt-1 block w-full rounded border border-border bg-card px-2 py-1 font-mono text-sm text-foreground"
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
        </NativeSelect>
      </Label>
      <Label className="block text-sm">
        <span className="block text-foreground">Note</span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1 block w-full rounded border border-border bg-card px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground"
          placeholder="What did you observe?"
        />
      </Label>
      <Label className="block text-sm">
        <span className="block text-foreground">Screenshot R2 key (optional)</span>
        <Input
          type="text"
          value={screenshotR2Key}
          onChange={(e) => setScreenshotR2Key(e.target.value)}
          maxLength={500}
          className="mt-1 block w-full rounded border border-border bg-card px-2 py-1 font-mono text-sm text-foreground placeholder:text-muted-foreground"
          placeholder="findings/2026/abc.png"
        />
      </Label>
      <Button
        type="submit"
        disabled={busy || sessionIds.length === 0}
        className="rounded bg-success px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit Finding'}
      </Button>
      {msg !== null ? <p className="text-sm text-foreground">{msg}</p> : null}
    </form>
  );
}
