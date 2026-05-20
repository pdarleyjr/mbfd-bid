// Members section — station info shared by Master Roster + per-station pages.
//
// Mirrors `apps/worker/src/lib/station-eligibility.ts` rule text and titles.
// Kept inline (rather than imported from @mbfd/shared) because the worker
// lib lives outside the shared package and the rule text rarely changes.

export type Station = 'marine' | 'trt' | 'de' | 'air-tech' | 'captain-5' | 'days';

export const STATIONS: ReadonlyArray<Station> = [
  'marine',
  'trt',
  'de',
  'air-tech',
  'captain-5',
  'days',
];

export function stationTitle(s: Station): string {
  switch (s) {
    case 'marine':
      return 'Marine Station';
    case 'trt':
      return 'TRT Station 2';
    case 'de':
      return 'DE (Driver / Engineer)';
    case 'air-tech':
      return 'Air Tech (810)';
    case 'captain-5':
      return 'Captain 5';
    case 'days':
      return 'Days';
  }
}

export function stationRuleText(s: Station): string {
  switch (s) {
    case 'marine':
      return 'Marine Station — eligible members hold MMC, IADRS Swim, Open Water Diver, and Public Safety Diver.';
    case 'trt':
      return 'TRT Station 2 — eligible members hold all six Operations certs (Hazmat, Rope, Confined Space, Structural Collapse, Trench, Vehicle & Machinery).';
    case 'de':
      return 'DE (Driver/Engineer) — eligible members hold Driver Engineer Qualified.';
    case 'air-tech':
      return 'Air Tech (810) — eligible members hold Cylinder Hazmat & FSO Compliance.';
    case 'captain-5':
      return 'Captain 5 — Captains who hold Firesafety Inspector I + (Firesafety Inspector II or Fire Investigator I) + (Instructor I or BLS Instructor).';
    case 'days':
      return 'Days — members assigned to a D-shift position in 2025 (or admin-tagged days-eligible).';
  }
}

/**
 * Notes attached to specific credentials by `credentials_master.json`.
 * Surface in tooltips on the cert toggle pills.
 */
export const CREDENTIAL_NOTES: Readonly<Record<string, string>> = {
  'Basic Life Support (BLS) INSTRUCTOR AHA': 'For Capt 5: Either/Or',
  'Fire Investigator (FL cert issued 2015 or later)': 'Investigator: Count 1 max',
  'Firesafety Inspector I': 'Count 1 max',
  'Instructor I': 'Count 1 max',
  'Pediatric Advanced Life Support (PALS) INSTRUCTOR AHA': 'Count 1 max',
};

export interface RosterMember {
  id: number;
  employee_id: string;
  last_name: string;
  first_name: string;
  rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  bid_category: 'OFC' | 'FF' | 'EXCLUDED';
  rsc_seniority: number;
  rank_seniority: number | null;
  ordinal: number;
  manual_override_ordinal: number | null;
  credential_ids: number[];
}

export interface CredentialRow {
  id: number;
  name: string;
  fyPointsDefault: number;
}

export const RANK_PILL_CLASS: Record<RosterMember['rank'], string> = {
  FF: 'bg-stone-700 text-stone-100',
  LT: 'bg-blue-700 text-blue-50',
  CPT: 'bg-amber-700 text-amber-50',
  DC: 'bg-purple-700 text-purple-50',
  DEP_CHIEF: 'bg-purple-800 text-purple-50',
  CHIEF: 'bg-red-800 text-red-50',
};
