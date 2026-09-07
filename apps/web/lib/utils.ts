import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind 3 requires tailwind-merge v2, including for adapted shadcn components. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
