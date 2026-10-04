'use client';

import { Button } from '@/components/ui/button';
import { type ReactElement, useState } from 'react';

interface Props {
  entry: { r2Key: string; kind: string; bytes: number; uploadedAt: string };
  sessionId: string;
}

function safeDownloadUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\\')) return false;
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  )
    return false;
  try {
    const parsed = new URL(value, window.location.origin);
    if (value.startsWith('/api/admin/exports/'))
      return (
        parsed.origin === window.location.origin &&
        parsed.pathname.startsWith('/api/admin/exports/')
      );
    return (
      /^https:\/\//i.test(value) &&
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function ExportCard({ entry, sessionId }: Props): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileName = entry.r2Key.split('/').pop() ?? entry.r2Key;
  return (
    <div className="export-card flex flex-wrap items-center gap-3 border-b border-border py-3 text-sm">
      <span className="kind rounded-md bg-muted px-2 py-1 text-xs font-semibold">{entry.kind}</span>
      <span className="key min-w-0 flex-1 break-all font-mono text-xs" title={entry.r2Key}>
        {fileName}
      </span>
      <span className="bytes">{Math.round(entry.bytes / 1024)} KB</span>
      <span className="when">{new Date(entry.uploadedAt).toLocaleString()}</span>
      {url ? (
        <a className="inline-flex min-h-11 items-center text-info underline" href={url} download>
          Download
        </a>
      ) : (
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const path = `/api/admin/exports/${encodeURIComponent(
                sessionId,
              )}/${encodeURIComponent(entry.r2Key)}/url`;
              const r = await fetch(path, { credentials: 'include', cache: 'no-store' });
              if (!r.ok)
                throw new Error(`The download link could not be loaded (${r.status}). Try again.`);
              const body: unknown = await r.json();
              const downloadUrl =
                body !== null && typeof body === 'object' && 'url' in body ? body.url : null;
              if (!safeDownloadUrl(downloadUrl))
                throw new Error('The download link was invalid. Try again.');
              setUrl(downloadUrl);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : 'The download link could not be loaded. Try again.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Loading…' : 'Get link'}
        </Button>
      )}
      {error ? (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
