'use client';

import { Button } from '@/components/ui/button';
import { presentationHref } from '@/lib/presentation-link';
import { useState } from 'react';

export function SessionPresentationLink({
  sessionId,
  isMock,
}: { sessionId: string; isMock: boolean }) {
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
      aria-label="Session presentation"
      data-bid-mode={isMock ? 'mock' : 'real'}
      className="flex flex-wrap items-center gap-3 text-sm"
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center font-semibold underline"
      >
        Open presentation
      </a>
      <Button type="button" onClick={() => void copy()}>
        Copy presentation link
      </Button>
      {notice ? <output>{notice}</output> : null}
    </nav>
  );
}
