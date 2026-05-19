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
}

export function MockBanner({ isMock, sessionId }: MockBannerProps): JSX.Element | null {
  if (!isMock) return null;
  return (
    <div
      data-testid="mock-banner"
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 w-full bg-red-700 px-4 py-2 text-center text-sm font-bold uppercase tracking-wide text-white shadow-md"
    >
      <span className="mr-2 inline-block animate-pulse">⚠</span>
      MOCK SESSION — NOT LIVE — picks will not be exported to portal
      <span className="ml-3 rounded bg-red-900 px-2 py-0.5 font-mono text-xs">{sessionId}</span>
    </div>
  );
}
