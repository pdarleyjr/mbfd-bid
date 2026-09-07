import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table
      data-slot="table"
      className={cn('w-full border-collapse text-sm tabular-nums', className)}
      {...props}
    />
  );
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted/60 [&_tr]:border-b', className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('border-b border-border transition-colors hover:bg-muted/50', className)}
      {...props}
    />
  );
}
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('px-3 py-3 text-left text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2 align-top', className)} {...props} />;
}
