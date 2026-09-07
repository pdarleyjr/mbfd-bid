// Retained historical filters only. Never use these predicates as Bid authority.
import type { Station } from '@mbfd/shared';
export { STATIONS, stationTitle, stationRuleText, type Station } from '@mbfd/shared';

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
