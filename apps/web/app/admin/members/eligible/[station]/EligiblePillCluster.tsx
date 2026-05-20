'use client';

import { useMemo } from 'react';
import { CREDENTIAL_NOTES, type CredentialRow } from '../../_lib/station-info';

interface Props {
  heldIds: number[];
  credentials: CredentialRow[];
}

/**
 * Read-only cluster of all credentials, with the held ones highlighted.
 * Mirrors the roster page pill cluster but without the toggle behavior —
 * eligibility pages are inspection-only.
 */
export function EligiblePillCluster({ heldIds, credentials }: Props) {
  const sorted = useMemo(
    () => [...credentials].sort((a, b) => a.name.localeCompare(b.name)),
    [credentials],
  );
  const heldSet = new Set(heldIds);

  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((cred) => {
        const held = heldSet.has(cred.id);
        const note = CREDENTIAL_NOTES[cred.name];
        return (
          <span
            key={cred.id}
            title={note ? `${cred.name} — ${note}` : cred.name}
            className={[
              'inline-flex max-w-[160px] truncate rounded px-2 py-0.5 text-[10px] font-medium',
              held ? 'bg-red-700 text-white' : 'border border-slate-600 text-slate-300',
            ].join(' ')}
          >
            {cred.name}
          </span>
        );
      })}
    </div>
  );
}
