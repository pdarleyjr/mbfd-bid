import type { ReactNode } from 'react';

/** Exact master artwork supplied by MBFD; do not replace with a generated mark. */
export const MBFD_MASTER_LOGO_PATH = '/mbfd-logo.png';

export function BrandHeader({ subtitle, action }: { subtitle?: string; action?: ReactNode }) {
  return (
    <header
      data-testid="brand-header"
      className="flex items-center gap-3 border-b border-border bg-sidebar px-4 py-3 text-white sm:px-6"
    >
      <img
        src={MBFD_MASTER_LOGO_PATH}
        alt="Miami Beach Fire Department"
        width={48}
        height={48}
        className="h-10 w-10 shrink-0 object-contain"
      />
      <div className="flex-1">
        <h1 className="font-heading text-base leading-tight">MBFD Annual Bid</h1>
        {subtitle && <p className="text-xs leading-tight text-stone-200/80">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
