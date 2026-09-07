import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export function Alert({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning',
        className,
      )}
      {...props}
    />
  );
}
