// Plan 09 / Rehearsal Tooling — Task R9.
// Read-only list of the most recent rehearsal findings across all mock sessions.

import type { ReactElement } from 'react';

export interface FindingRow {
  id: string;
  bidSessionId: string;
  createdAt: string;
  authorId: number | null;
  note: string;
  screenshotR2Key: string | null;
}

interface Props {
  findings: FindingRow[];
}

export function FindingsList({ findings }: Props): ReactElement {
  if (findings.length === 0) {
    return (
      <p className="rounded border border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
        No findings recorded yet. Use the form on the right to capture observations.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {findings.map((f) => (
        <li
          key={f.id}
          data-testid={`finding-${f.id}`}
          className="rounded border border-stone-300 bg-white p-3 text-sm"
        >
          <div className="flex flex-wrap items-baseline gap-2 text-xs text-stone-600">
            <span className="font-mono">{f.bidSessionId}</span>
            <span>· {new Date(f.createdAt).toLocaleString()}</span>
            {f.authorId !== null ? <span>· author #{f.authorId}</span> : null}
            {f.screenshotR2Key !== null ? (
              <span className="font-mono text-blue-700">{f.screenshotR2Key}</span>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-stone-900">{f.note}</p>
        </li>
      ))}
    </ul>
  );
}
