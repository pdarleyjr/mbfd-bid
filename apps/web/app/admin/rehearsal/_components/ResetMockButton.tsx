import { Button } from '@/components/ui/button';
import type { ReactElement } from 'react';

interface Props {
  sessionId: string;
}

export function ResetMockButton({ sessionId }: Props): ReactElement {
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        disabled
        title={`Reset for mock session ${sessionId} requires an audited reset epoch.`}
        className="rounded bg-destructive px-3 py-1 text-primary-foreground text-xs disabled:opacity-50"
      >
        Reset unavailable
      </Button>
      <span className="text-xs text-foreground">Requires audited reset epoch</span>
    </span>
  );
}
