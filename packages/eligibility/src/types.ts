export type Rank = 'CHIEF' | 'DEP_CHIEF' | 'DC' | 'CPT' | 'LT' | 'FF';

export interface Credential {
  name: string;
}

export interface Member {
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: Rank;
  rscSeniority: number;
  rankSeniority: number | undefined;
  isProbationary: boolean;
  credentials: Credential[];
}

/**
 * Controls which Operations credentials must accompany a points credential.
 * Omit this to retain legacy `requiresOpsPair` behavior.
 */
export type OpsGate = 'paired_operation' | 'all_operations';

export interface PointsItem {
  points: number;
  credential: string;
  requiresOpsPair: boolean;
  opsGate?: OpsGate;
}

export interface RequiredCriteria {
  rank: Rank[];
  credentials: string[];
  custom: Array<'paramedic' | 'driver_engineer' | 'non_probationary'>;
}

export interface PointsPreference {
  max: number;
  items: PointsItem[];
}

export type TieBreakKey = 'points' | 'so_points' | 'mo_points' | 'rsc_seniority' | 'rank_seniority';

export interface PositionRule {
  positionId: string;
  ruleBookVersion: string;
  requiredCriteria: RequiredCriteria;
  pointsPreference: PointsPreference;
  tieBreakChain: TieBreakKey[];
}

export interface EligibilityReason {
  code: string;
  label: string;
  satisfied: boolean;
}

export interface PointsBreakdown {
  total: number;
  soTotal: number;
  moTotal: number;
  itemized: Array<{ credential: string; awarded: number; reason?: string }>;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  points: number;
  soPoints: number;
  moPoints: number;
  breakdown: PointsBreakdown;
}
