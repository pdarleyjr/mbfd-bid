export { STATIONS, stationTitle, stationRuleText, type Station } from '@mbfd/shared';

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
  rank: 'CIVILIAN' | 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  bid_category: 'OFC' | 'FF' | 'EXCLUDED';
  rsc_seniority: number | null;
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
  CIVILIAN: 'bg-success-surface text-success',
  FF: 'bg-muted text-foreground',
  LT: 'bg-info-surface text-info',
  CPT: 'bg-warning text-primary-foreground',
  DC: 'bg-purple-700 text-purple-50',
  DEP_CHIEF: 'bg-purple-800 text-purple-50',
  CHIEF: 'bg-destructive text-primary-foreground',
};
