export const SHIFTS = ['A', 'B', 'C', 'D'] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  D: 'D Shift (Days)',
};
