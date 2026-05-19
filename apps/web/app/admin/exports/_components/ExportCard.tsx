'use client';

import { type ReactElement, useState } from 'react';

interface Props {
  entry: { r2Key: string; kind: string; bytes: number; uploadedAt: string };
  sessionId: string;
}

export function ExportCard({ entry, sessionId }: Props): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const fileName = entry.r2Key.split('/').pop() ?? entry.r2Key;
  return (
    <div className="export-card">
      <span className="kind">{entry.kind}</span>
      <span className="key" title={entry.r2Key}>
        {fileName}
      </span>
      <span className="bytes">{Math.round(entry.bytes / 1024)} KB</span>
      <span className="when">{new Date(entry.uploadedAt).toLocaleString()}</span>
      {url ? (
        <a href={url} download>
          Download
        </a>
      ) : (
        <button
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
        </button>
      )}
    </div>
  );
}
