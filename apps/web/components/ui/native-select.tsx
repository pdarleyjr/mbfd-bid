import { cn } from '@/lib/utils';
import { type ComponentProps, forwardRef } from 'react';
import { fieldVariants } from './input';

/** Native keyboard, mobile picker and FormData behavior remain intact. */
export const NativeSelect = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      data-slot="native-select"
      className={cn(fieldVariants, className)}
      {...props}
    />
  ),
);
NativeSelect.displayName = 'NativeSelect';
