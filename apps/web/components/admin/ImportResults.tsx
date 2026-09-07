'use client';

import type { ImportResult } from '@/lib/import-types';

type Props = {
  result: ImportResult;
};

export function ImportResults({ result }: Props) {
  if ('error' in result) {
    return (
      <div className="mt-6 rounded border border-destructive/40 bg-destructive-surface p-4 text-destructive">
        <strong>Error:</strong> {result.error}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3 text-foreground">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Inserted</div>
          <div className="font-mono text-2xl tabular-nums">{result.inserted}</div>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Updated</div>
          <div className="font-mono text-2xl tabular-nums">{result.updated}</div>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Errors</div>
          <div className="font-mono text-2xl tabular-nums text-destructive">
            {result.errors.length}
          </div>
        </div>
      </div>

      {result.errors.length > 0 && (
        <details className="rounded border border-border bg-card p-3">
          <summary className="cursor-pointer text-foreground">Show errors</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {result.errors.map((e) => (
              <li
                key={`${e.rowNumber}:${e.message}`}
                className="rounded bg-card p-2 font-mono text-foreground"
              >
                <span className="text-destructive">Row {e.rowNumber}:</span> {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
