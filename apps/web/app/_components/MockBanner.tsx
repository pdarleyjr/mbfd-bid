// Plan 09 / Rehearsal Tooling — Task R7.
//
// Sticky red banner shown across the top of /bid and /admin/bid whenever the
// underlying bid session is marked `is_mock=1`. Rendered as a Server Component
// so the determination is made at the same time the page reads the session
// snapshot — there is no client-side flicker between "live" and "mock".
//
// When `isMock=false` the component renders `null` so no DOM is emitted at
// all. The session id is included in the banner so the operator can verify
// at a glance which session is in rehearsal mode.

import type { JSX } from 'react';

export interface MockBannerProps {
  isMock: boolean;
  sessionId: string;
  compact?: boolean;
}

export function MockBanner({
  isMock,
  sessionId,
  compact = false,
}: MockBannerProps): JSX.Element | null {
  if (!isMock) return null;
  return (
    <div
      data-testid="mock-banner"
      role="alert"
      aria-live="assertive"
      title={`Mock session ${sessionId}. Picks will not be exported to the portal.`}
      className={`sticky top-0 z-40 flex w-full flex-wrap items-center justify-center gap-2 bg-red-700 px-3 ${compact ? 'py-1' : 'py-2'} text-center text-xs font-bold uppercase tracking-wide text-white shadow-md`}
    >
      <span aria-hidden="true">⚠</span>
      MOCK SESSION — NOT LIVE
      <span className="hidden sm:inline">· Picks stay in this rehearsal</span>
      <span className="sr-only">
        {' '}
        · Picks will not be exported to the portal. Session {sessionId}
      </span>
    </div>
  );
}
