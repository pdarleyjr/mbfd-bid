import { cn } from '@/lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import { type ComponentProps, forwardRef } from 'react';

export const buttonVariants = cva(
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-normal rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-input bg-card text-foreground hover:brightness-95',
        primary: 'border border-primary bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
        secondary:
          'border border-transparent bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'border border-transparent hover:bg-accent hover:text-accent-foreground',
        link: 'min-h-0 border-0 p-0 text-info underline-offset-4 hover:underline',
      },
      size: { default: '', sm: 'px-3 text-xs', icon: 'h-11 w-11 p-2' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** Native button preserves form semantics; links use buttonVariants on an anchor. */
export const Button = forwardRef<
  HTMLButtonElement,
  ComponentProps<'button'> & VariantProps<typeof buttonVariants>
>(({ className, variant, size, ...props }, ref) => (
  <button
    ref={ref}
    data-slot="button"
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
));
Button.displayName = 'Button';
