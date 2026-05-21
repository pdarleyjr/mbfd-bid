/**
 * Shared types for the rich bid board (admin + member). Co-located so any
 * page that renders the board grid stays in lockstep with the Worker payload.
 */

export type Shift = 'A' | 'B' | 'C' | 'D';

export interface MemberLite {
  id: number;
  firstName: string;
  lastName: string;
  rank: string;
  employeeId: string;
}

export interface PositionMeta {
  id: string;
  shift: Shift;
  station: string;
  division: string;
  unit: string;
  rankRequired: string;
  positionName: string;
  isFloating?: boolean;
  isVacantByDesign?: boolean;
  isExcludedFromCount?: boolean;
}

export const ALL_SHIFTS: ReadonlyArray<Shift> = ['A', 'B', 'C', 'D'];

export const SHIFT_LABEL: Readonly<Record<Shift, string>> = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  D: 'D / Days',
};

const RANK_SHORT: Readonly<Record<string, string>> = {
  FF: 'FF',
  LT: 'Lt',
  CPT: 'Capt',
  DC: 'DC',
  DEP_CHIEF: 'Dep Chief',
  CHIEF: 'Chief',
};

export function shortRank(rank: string): string {
  return RANK_SHORT[rank] ?? rank;
}
