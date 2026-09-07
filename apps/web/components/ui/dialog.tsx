'use client';

import { cn } from '@/lib/utils';
import { Dialog as Primitive } from '@base-ui/react/dialog';
import type { ComponentProps, ReactNode } from 'react';

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Popup>) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="fixed inset-0 z-40 bg-sidebar/50" />
      <Primitive.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </Primitive.Popup>
    </Primitive.Portal>
  );
}

/** Compatibility composition for existing domain dialogs; handlers stay with the feature. */
export function ConfirmationDialog({
  children,
  onClose,
  busy = false,
  className,
  ...props
}: {
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent {...props} className={className}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
