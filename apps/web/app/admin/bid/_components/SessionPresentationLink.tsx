'use client';

import { Button } from '@/components/ui/button';
import { presentationHref } from '@/lib/presentation-link';
import { useState } from 'react';

export function SessionPresentationLink({
  sessionId,
  isMock,
  compact = false,
  variant = 'full',
}: { sessionId: string; isMock: boolean; compact?: boolean; variant?: 'full' | 'link' | 'copy' }) {
  const [notice, setNotice] = useState<string | null>(null);
  const href = presentationHref(sessionId);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setNotice('Presentation link copied.');
    } catch {
      setNotice('Copy unavailable. Open the presentation and copy its address.');
    }
  }
  return (
    <nav
      aria-label={variant === 'copy' ? 'Presentation link tools' : 'Session presentation'}
      data-bid-mode={isMock ? 'mock' : 'real'}
      className={
        compact
          ? 'flex flex-wrap items-center gap-2 text-xs'
          : 'flex flex-wrap items-center gap-3 text-sm'
      }
    >
      {variant !== 'copy' ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center font-semibold underline"
          aria-label="Open presentation"
        >
          {compact ? 'Presentation' : 'Open presentation'}
        </a>
      ) : null}
      {variant !== 'link' ? (
        <Button
          type="button"
          aria-label="Copy presentation link"
          size={compact ? 'sm' : 'default'}
          onClick={() => void copy()}
        >
          {compact ? 'Copy link' : 'Copy presentation link'}
        </Button>
      ) : null}
      {notice ? <output>{notice}</output> : null}
    </nav>
  );
}
