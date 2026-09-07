import { cn } from '@/lib/utils';
import { type ComponentProps, forwardRef } from 'react';
import { fieldVariants } from './input';

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(fieldVariants, 'min-h-24', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
