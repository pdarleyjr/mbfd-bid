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
  bidOrdinalEvidence?:
    | {
        datasetId: string;
        sourceSha256: string;
        timeInGrade: number;
        departmentService: number;
      }
    | undefined;
  isProbationary: boolean;
  credentials: Credential[];
  memberId?: number;
  scoringEvidence?: { evaluationOn: string; completedCredentialNames: string[] } | undefined;
  serviceCredits?: {
    serviceCode: string;
    verifiedMonths: number | null;
    effectiveOn: string;
    recordId: string;
    sourceRef: string;
    actorSubject: string;
  }[];
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
  anyOfCredentials?: string[][];
  service?: { serviceCode: string; minimumMonths: number }[];
  /** Follow-up terms do not determine initial qualification or points. */
  postAward?: {
    id: string;
    credential: string;
    sourceRef: string;
    deadline: {
      unit: 'CALENDAR_DAYS' | 'CALENDAR_MONTHS';
      count: number;
      timeZone: 'America/New_York' | 'UTC';
    } & ({ basis: 'FINAL_POSITION_AWARD' } | { basis: 'APPROVED_BID_START_DATE'; startOn: string });
  }[];
  custom: Array<'paramedic' | 'driver_engineer' | 'non_probationary'>;
}

export interface PointsPreference {
  max: number;
  items: PointsItem[];
  scoring?: {
    v: 1;
    total: ScoringGroup[];
    so: ScoringGroup[];
    mo: ScoringGroup[];
    orderedPreference?: OrderedQualificationPreference | undefined;
  };
}

export interface OrderedQualificationPreference {
  mode: 'ORDERED_QUALIFICATIONS';
  sourceRef: string;
  criteria: { credential: string; alternatives: string[]; requiresAll: string[] }[];
}

export interface OrderedPreferenceResult {
  sourceRef: string;
  criteria: (OrderedQualificationPreference['criteria'][number] & { value: 0 | 1 })[];
}

export interface ScoringGroup {
  id: string;
  cap: number | null;
  excludesAny?: string[] | undefined;
  /** Source-backed cumulative preferences count satisfied criteria, without policy weights. */
  preference?:
    | {
        mode: 'BINARY_CUMULATIVE';
        sourceRef: string;
        criteria: { credential: string; alternatives: string[]; requiresAll: string[] }[];
      }
    | undefined;
  items: {
    credential: string;
    alternatives: string[];
    requiresAll: string[];
    points: number;
    completionCredit?:
      | {
          sourceRef: string;
          effectiveFrom: string;
          effectiveThrough: string;
          memberIds?: number[] | undefined;
        }
      | undefined;
  }[];
}

export type TieBreakKey =
  | 'points'
  | 'so_points'
  | 'mo_points'
  | 'rsc_seniority'
  | 'rank_seniority'
  | 'time_in_grade_bid_ordinal'
  | 'department_service_bid_ordinal';

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
  orderedPreference?: OrderedPreferenceResult | undefined;
  eligible: boolean;
  reasons: EligibilityReason[];
  points: number;
  soPoints: number;
  moPoints: number;
  breakdown: PointsBreakdown;
}
