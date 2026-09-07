import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export function Label({ className, htmlFor, children, ...props }: ComponentProps<'label'>) {
  return (
    <label
      htmlFor={htmlFor}
      data-slot="label"
      className={cn('text-sm font-medium', className)}
      {...props}
    >
      {children}
    </label>
  );
}
