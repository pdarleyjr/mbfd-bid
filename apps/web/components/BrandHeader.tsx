import type { ReactNode } from 'react';

export function BrandHeader({ subtitle, action }: { subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 border-b border-stone-200 bg-slate-850 px-4 py-4 text-white sm:px-6">
      <div
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-md bg-red-700 font-heading text-base font-bold leading-none"
      >
        FD
      </div>
      <div className="flex-1">
        <h1 className="font-heading text-base leading-tight">MBFD Annual Bid</h1>
        {subtitle && <p className="text-xs leading-tight text-stone-200/80">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
