'use client';

import { Button } from '@/components/ui/button';
import { type ReactElement, useState } from 'react';

interface Props {
  entry: { r2Key: string; kind: string; bytes: number; uploadedAt: string };
  sessionId: string;
}

export function ExportCard({ entry, sessionId }: Props): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
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
          onClick={async () => {
            const path = `/api/admin/exports/${encodeURIComponent(
              sessionId,
            )}/${encodeURIComponent(entry.r2Key)}/url`;
            const r = await fetch(path, { credentials: 'include' });
            if (!r.ok) return;
            const b = (await r.json()) as { url: string };
            setUrl(b.url);
          }}
        >
          Get link
        </Button>
      )}
    </div>
  );
}
