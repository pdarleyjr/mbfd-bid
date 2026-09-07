'use client';

import { cn } from '@/lib/utils';
import { Tabs as Primitive } from '@base-ui/react/tabs';
import type { ComponentProps } from 'react';

export const Tabs = Primitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn('flex gap-1 rounded-lg border border-border bg-card p-1', className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Tab>) {
  return (
    <Primitive.Tab
      className={cn(
        'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-info data-[active]:text-primary-foreground',
        className,
      )}
      {...props}
    />
  );
}
