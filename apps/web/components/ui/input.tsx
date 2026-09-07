import { cn } from '@/lib/utils';
import { type ComponentProps, forwardRef } from 'react';

export const fieldVariants =
  'min-h-11 min-w-0 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        type === 'checkbox' || type === 'radio'
          ? 'h-4 w-4 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
          : fieldVariants,
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
