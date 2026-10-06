export type ShiftExportScope = 'A' | 'B' | 'C' | 'D' | 'ALL';
/** Shared pure parser; Server Components must not call a client export. */
export function shiftExportScope(value: unknown): ShiftExportScope {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' ? value : 'ALL';
}
