import type { ReactElement } from 'react';

interface Props {
  sessionId: string;
}

export function ResetMockButton({ sessionId }: Props): ReactElement {
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled
        title={`Reset for mock session ${sessionId} requires an audited reset epoch.`}
        className="rounded bg-red-700 px-3 py-1 text-white text-xs disabled:opacity-50"
      >
        Reset unavailable
      </button>
      <span className="text-xs text-stone-700">Requires audited reset epoch</span>
    </span>
  );
}
