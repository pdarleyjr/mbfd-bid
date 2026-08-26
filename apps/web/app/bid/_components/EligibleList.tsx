'use client';

interface Props {
  positionIds: string[];
  onPick: (id: string) => void;
  submitting: string | null;
  disabled?: boolean;
}

export function EligibleList({ positionIds, onPick, submitting, disabled = false }: Props) {
  return (
    <ul className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
      {positionIds.map((id) => (
        <li key={id}>
          <button
            type="button"
            data-testid={`eligible-position-${id}`}
            disabled={disabled || submitting !== null}
            onClick={() => onPick(id)}
            className="w-full rounded border border-red-700 bg-white px-3 py-2 text-left font-mono text-sm tabular-nums hover:bg-red-100 disabled:opacity-50"
          >
            {id}
            {submitting === id ? ' — submitting…' : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
