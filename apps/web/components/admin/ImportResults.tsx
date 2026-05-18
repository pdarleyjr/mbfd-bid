'use client';

import type { ImportResult } from '@/app/admin/members/import/actions';

type Props = {
  result: ImportResult;
};

export function ImportResults({ result }: Props) {
  if ('error' in result) {
    return (
      <div className="mt-6 rounded border border-red-700 bg-red-950/20 p-4 text-red-100">
        <strong>Error:</strong> {result.error}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3 text-stone-100">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border border-stone-700 bg-slate-900 p-3">
          <div className="text-xs text-stone-400">Inserted</div>
          <div className="font-mono text-2xl tabular-nums">{result.inserted}</div>
        </div>
        <div className="rounded border border-stone-700 bg-slate-900 p-3">
          <div className="text-xs text-stone-400">Updated</div>
          <div className="font-mono text-2xl tabular-nums">{result.updated}</div>
        </div>
        <div className="rounded border border-stone-700 bg-slate-900 p-3">
          <div className="text-xs text-stone-400">Errors</div>
          <div className="font-mono text-2xl tabular-nums text-red-300">{result.errors.length}</div>
        </div>
      </div>

      {result.errors.length > 0 && (
        <details className="rounded border border-stone-700 bg-slate-900 p-3">
          <summary className="cursor-pointer text-stone-300">Show errors</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {result.errors.map((e) => (
              <li
                key={`${e.rowNumber}:${e.message}`}
                className="rounded bg-slate-950 p-2 font-mono text-stone-300"
              >
                <span className="text-red-300">Row {e.rowNumber}:</span> {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
