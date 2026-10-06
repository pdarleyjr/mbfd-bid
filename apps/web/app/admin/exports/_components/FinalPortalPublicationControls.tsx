'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { z } from 'zod';

const PreviewSchema = z.object({
  source_sequence: z.number().int().nonnegative(),
  source_result_hash: z.string(),
  manifest_sha256: z.string(),
  confirmation_phrase: z.string(),
  publication_enabled: z.boolean(),
  counts: z.object({
    bid_award: z.literal(218),
    retained_nonbiddable: z.literal(8),
    total: z.literal(226),
    hub_matched: z.literal(226),
  }),
  metadata_overrides: z.array(
    z.object({
      position_id: z.string(),
      before: z.string(),
      after: z.string(),
      reason: z.string(),
    }),
  ),
});
type Preview = z.infer<typeof PreviewSchema>;

export function FinalPortalPublicationControls({ sessionId }: { sessionId: string }) {
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(operation: 'preview' | 'publish') {
    if (!source) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/portal-final/${encodeURIComponent(sessionId)}/${operation}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...source,
            ...(operation === 'publish' ? { confirmation_phrase: confirmation } : {}),
          }),
        },
      );
      const result: unknown = await response.json();
      if (!response.ok) {
        const error = z
          .object({ error: z.string().optional(), issues: z.array(z.unknown()).optional() })
          .safeParse(result);
        const details = error.success ? error.data : {};
        setMessage(
          response.status === 403
            ? 'Sign in again to review or publish final assignments.'
            : `Review blocked: ${details.error ?? response.status}${details.issues ? ` (${details.issues.map((issue: unknown) => (typeof issue === 'string' ? issue : 'invalid source field')).join(', ')})` : ''}`,
        );
        if (operation === 'preview') setPreview(null);
        return;
      }
      if (operation === 'preview') setPreview(PreviewSchema.parse(result));
      else {
        setMessage('Final assignments are queued. Refresh Portal sync status to verify delivery.');
        setConfirmation('');
      }
    } catch {
      setMessage(
        'The final assignment service could not be reached. Refresh status before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-5 space-y-4 border-t border-border pt-4">
      <h3 className="font-heading font-semibold">Publish final assignments</h3>
      <p className="text-sm text-muted-foreground">
        Upload the reviewed final workbook reconciliation request. Preview verifies the completed
        Real session and includes retained assignments.
      </p>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Private final source request (JSON)</span>
        <input
          type="file"
          accept=".json,application/json"
          className="block min-h-11 max-w-full"
          disabled={busy}
          onChange={async (event) => {
            setSource(null);
            setPreview(null);
            setConfirmation('');
            setMessage(null);
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) {
              setMessage('The source request must be smaller than 1 MB.');
              return;
            }
            try {
              const value = JSON.parse(await file.text());
              if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('invalid source');
              setSource(value);
            } catch {
              setMessage('Choose a valid final source request JSON file.');
            }
          }}
        />
      </label>
      <Button type="button" disabled={!source || busy} onClick={() => submit('preview')}>
        {busy ? 'Checking…' : 'Preview final assignments'}
      </Button>
      {preview && (
        <div
          className="space-y-3 rounded-lg border border-border p-4"
          data-testid="final-publication-preview"
        >
          <p className="tabular-nums">
            {preview.counts.bid_award} awards · {preview.counts.retained_nonbiddable} retained
            assignments · {preview.counts.hub_matched} matched employees
          </p>
          <p className="text-sm">Preview completed without changes.</p>
          {preview.metadata_overrides.length > 0 && (
            <div>
              <p className="font-medium">Final workbook seat descriptions</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {preview.metadata_overrides.map((row) => (
                  <li key={row.position_id}>
                    {row.position_id}: {row.before} → {row.after}. {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!preview.publication_enabled && (
            <p className="text-sm">
              Publication is disabled. Enable the verified Hub receiver before publishing.
            </p>
          )}
          <label className="block space-y-2">
            <span className="block text-sm">
              To publish, enter exactly: <strong>{preview.confirmation_phrase}</strong>
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || !preview.publication_enabled}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              autoComplete="off"
            />
          </label>
          <Button
            type="button"
            disabled={
              busy || !preview.publication_enabled || confirmation !== preview.confirmation_phrase
            }
            onClick={() => submit('publish')}
          >
            Publish {preview.counts.total} final assignments
          </Button>
        </div>
      )}
      {message && (
        <output aria-live="polite" className="block text-sm">
          {message}
        </output>
      )}
    </div>
  );
}
