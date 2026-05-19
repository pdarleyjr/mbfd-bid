// Plan 08 Task 13 — Suspense fallback for the roster RSC.

import type { ReactElement } from 'react';

export default function Loading(): ReactElement {
  return (
    <main className="roster-page">
      <p>Loading roster…</p>
    </main>
  );
}
