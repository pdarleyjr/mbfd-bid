// Plan 08 Task 18 — Build a PortalPayload from DB rows (spec §11.8.2).
//
// Translates internal codes (rank short codes, shift letter, group code) into
// the human-friendly labels the portal expects, and resolves the
// admin-actor employee ID when the bid was forced.

import type { PortalPayload, RankLabel, ShiftLabel } from '@mbfd/shared';

const RANK_LABEL: Record<string, RankLabel> = {
  FF: 'Firefighter',
  LT: 'Lieutenant',
  CPT: 'Captain',
  DC: 'Division Chief',
  DEP_CHIEF: 'Deputy Fire Chief',
  CHIEF: 'Fire Chief',
};

const SHIFT_LABEL: Record<string, ShiftLabel> = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  D: 'D Shift',
};

const GROUP_LABEL: Record<string, string> = {
  G1: 'Group 1',
  G2: 'Group 2',
  G3: 'Group 3',
  G4: 'Group 4',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

export interface BuildArgs {
  bid: {
    id: string;
    bidSessionId: string;
    memberId: number;
    positionId: string;
    aDay: string | null;
    pickedAt: Date;
    forced: boolean;
    adminActorId: number | null;
  };
  member: { id: number; employeeId: string; rank: keyof typeof RANK_LABEL };
  /** Resolved admin row when the bid was forced; null for self-picks. */
  adminActor: { id: number; employeeId: string } | null;
  position: { id: string; shift: keyof typeof SHIFT_LABEL; station: string; unit: string };
  bidYear: number;
}

export function buildPortalPayload(a: BuildArgs): PortalPayload {
  const aDayLabel = a.bid.aDay ? (GROUP_LABEL[a.bid.aDay] ?? a.bid.aDay) : 'Pending Phase 2';
  const rank = RANK_LABEL[a.member.rank];
  const shift = SHIFT_LABEL[a.position.shift];
  if (!rank) throw new Error(`Unknown rank code: ${a.member.rank}`);
  if (!shift) throw new Error(`Unknown shift code: ${a.position.shift}`);
  return {
    bid_year: a.bidYear,
    bid_session_id: a.bid.bidSessionId,
    rank_label: rank,
    station_label: `Station ${a.position.station}`,
    shift_label: shift,
    unit_label: a.position.unit,
    a_day_label: aDayLabel,
    position_id: a.position.id,
    picked_at: a.bid.pickedAt.toISOString(),
    idempotency_key: a.bid.id,
    is_forced: a.bid.forced,
    admin_actor_employee_id: a.adminActor?.employeeId ?? null,
  };
}
