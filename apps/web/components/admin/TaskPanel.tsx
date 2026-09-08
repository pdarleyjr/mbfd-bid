'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** A focused task keeps its title and close action visible while details remain accessible. */
export function TaskPanel({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] max-w-3xl flex-col overflow-hidden p-0">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="break-words font-heading text-xl font-semibold">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close panel"
            className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
          >
            <X size={20} />
          </DialogClose>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
