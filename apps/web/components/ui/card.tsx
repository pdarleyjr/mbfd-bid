import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('space-y-2 p-5', className)} {...props} />;
}
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('font-heading text-lg font-semibold', className)} {...props} />;
}
export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
  );
}
export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}
