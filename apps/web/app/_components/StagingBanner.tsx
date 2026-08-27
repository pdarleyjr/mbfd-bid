import type { JSX } from 'react';

export interface StagingBannerProps {
  environment: string | undefined;
}

export function StagingBanner({ environment }: StagingBannerProps): JSX.Element | null {
  if (environment !== 'staging') return null;

  return (
    <output
      data-testid="staging-banner"
      aria-live="polite"
      className="block border-b-2 border-amber-900 bg-amber-300 px-4 py-2 text-center text-sm font-extrabold tracking-wide text-amber-950"
    >
      MBFD BID — STAGING — TESTING ONLY — no production changes are permitted here
    </output>
  );
}
