import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground',
        className,
      )}
      {...props}
    />
  );
}
