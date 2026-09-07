'use client';

import { cn } from '@/lib/utils';
import { Collapsible as Primitive } from '@base-ui/react/collapsible';
import type { ComponentProps } from 'react';

export const Collapsible = Primitive.Root;
export const CollapsibleTrigger = Primitive.Trigger;
export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Panel>) {
  return <Primitive.Panel className={cn('data-[closed]:hidden', className)} {...props} />;
}
