// Members section — station eligibility rules for the admin Members UI.
//
// Each station defines a predicate over a member's rank + held credential
// names + 2025 position prefix (for D-shift "days" detection). The rule set
// is the literal text the chief gave us; if a future bid year changes the
// gate, edit it here in one place.
//
// Cert-name aliasing: legacy spreadsheets reference "Certified Public Safety
// Diver" but the canonical credentials table stores "Public Safety Diver".
// Treat both as the same cert.

export type Station = 'marine' | 'trt' | 'de' | 'air-tech' | 'captain-5' | 'days';

export const STATIONS: ReadonlyArray<Station> = [
  'marine',
  'trt',
  'de',
  'air-tech',
  'captain-5',
  'days',
];

export interface EligibilityCandidate {
  rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  credentialNames: ReadonlyArray<string>;
  /** Employee ID — used to match against the 2025 D-shift roster. */
  employeeId: string;
  /** Optional admin-tagged days-eligible flag (Plan future). */
  daysEligible?: boolean;
}

/**
 * Employee IDs of the 8 members who held a D-shift position in the 2025 bid
 * (derived from `analysis/2025_bid_extract/members_2026_synthesis.json`).
 *
 * Until the members table grows a `position_2025` column or a `days_eligible`
 * flag, the "days" station rule consults this constant. The 2026 roster QA
 * use-case the chief is running this week needs no more than this — anyone
 * the chief wants to surface as days-eligible who isn't in this list can be
 * granted the cert taxonomy that makes them eligible via the toggle UI.
 */
export const D_SHIFT_2025_EMPLOYEE_IDS: ReadonlyArray<string> = [
  '16563', // Betancourt Francois — D102 Captain
  '19960', // Chavez Christian — D101 Captain
  '19964', // Martinez Sergio — D201 Captain
  '18359', // Quintela Richard — D301 Captain
  '16565', // Ochoa Isabel — D104 Lieutenant
  '19124', // Johnson Paul — D103 Lieutenant
  '20732', // Gato Daniel — D401 Lieutenant
  '17593', // Navas Claudio — D402 Lieutenant
];

const MARINE_REQUIRED: ReadonlyArray<string> = [
  'Open Water Diver Certified',
  'IADRS Swim Evaluation',
  'Public Safety Diver',
  'Merchant Mariner Credential (MMC)',
];

const TRT_OPERATIONS: ReadonlyArray<string> = [
  'Hazardous Materials Operations',
  'Rope Rescue Operations',
  'Confined Space Operations',
  'Structural Collapse Operations',
  'Trench Rescue Operations',
  'Vehicle & Machinery Rescue Operations',
];

const CAPTAIN_5_INSPECTOR_GATE: ReadonlyArray<string> = [
  'Firesafety Inspector II',
  'Fire Investigator I',
];

const CAPTAIN_5_INSTRUCTOR_GATE: ReadonlyArray<string> = [
  'Instructor I',
  'Basic Life Support (BLS) INSTRUCTOR AHA',
];

/** Returns whether the candidate is eligible for a given station. */
export function isEligibleFor(station: Station, c: EligibilityCandidate): boolean {
  const hasAll = (xs: ReadonlyArray<string>) => xs.every((name) => has(c.credentialNames, name));
  const hasAny = (xs: ReadonlyArray<string>) => xs.some((name) => has(c.credentialNames, name));

  switch (station) {
    case 'marine':
      return hasAll(MARINE_REQUIRED);
    case 'trt':
      return hasAll(TRT_OPERATIONS);
    case 'de':
      return has(c.credentialNames, 'Driver Engineer Qualified');
    case 'air-tech':
      return has(c.credentialNames, 'Cylinder Hazmat & FSO Compliance (AIR TECH REQUIREMENT)');
    case 'captain-5':
      return (
        c.rank === 'CPT' &&
        has(c.credentialNames, 'Firesafety Inspector I') &&
        hasAny(CAPTAIN_5_INSPECTOR_GATE) &&
        hasAny(CAPTAIN_5_INSTRUCTOR_GATE)
      );
    case 'days':
      // Members who held a D-shift position in the 2025 bid (see
      // D_SHIFT_2025_EMPLOYEE_IDS) OR who are explicitly tagged via the
      // future `daysEligible` flag.
      return c.daysEligible === true || D_SHIFT_2025_EMPLOYEE_IDS.includes(c.employeeId);
  }
}

/** Human-readable rule string for the station, displayed beneath the title. */
export function stationRuleText(station: Station): string {
  switch (station) {
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

/** Display name for the station (used in page titles and breadcrumbs). */
export function stationTitle(station: Station): string {
  switch (station) {
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

/** Returns true if `c.credentialNames` contains either `wanted` or a known alias. */
function has(names: ReadonlyArray<string>, wanted: string): boolean {
  if (names.includes(wanted)) return true;
  // Public Safety Diver alias: the legacy spreadsheet shows "Certified Public
  // Safety Diver"; treat both as the same cert.
  if (wanted === 'Public Safety Diver' && names.includes('Certified Public Safety Diver')) {
    return true;
  }
  if (wanted === 'Certified Public Safety Diver' && names.includes('Public Safety Diver')) {
    return true;
  }
  return false;
}
